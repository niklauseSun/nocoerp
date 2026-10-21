import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { licenseWatermarkSvg } from '../hyl/license-watermark-art.js';

const tile = Buffer.from(licenseWatermarkSvg);

/** Derive protected content on demand; originals and upload hashes remain unchanged. */
export async function watermarkLicense(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  if (mimeType === 'application/pdf') {
    // Refuse encrypted or malformed documents instead of falling back to the original.
    const document = await PDFDocument.load(bytes);
    if (document.getPageCount() > 100)
      throw new Error('Too many license pages');
    const stamp = await document.embedPng(await sharp(tile).png().toBuffer());
    let tiles = 0;
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      if (width <= 0 || height <= 0 || width > 14400 || height > 14400)
        throw new Error('Invalid page size');
      const stampWidth = Math.min(360, width);
      const stampHeight = (stampWidth * 220) / 480;
      tiles += Math.ceil(width / stampWidth) * Math.ceil(height / stampHeight);
      if (tiles > 10000) throw new Error('Too many watermark tiles');
      for (let y = 0; y < height; y += stampHeight)
        for (let x = 0; x < width; x += stampWidth)
          page.drawImage(stamp, {
            x,
            y,
            width: stampWidth,
            height: stampHeight,
          });
    }
    return document.save();
  }
  if (!['image/png', 'image/jpeg'].includes(mimeType))
    throw new Error('Unsupported license format');
  const image = sharp(bytes, { limitInputPixels: 30_000_000 }).rotate();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error('Missing image dimensions');
  // Scale the repeating tile for small scans so the watermark remains visible.
  const stamp = await sharp(tile)
    .resize({ width: Math.min(480, width, height), withoutEnlargement: true })
    .png()
    .toBuffer();
  const result = image.composite([{ input: stamp, tile: true }]);
  return mimeType === 'image/png'
    ? result.png().toBuffer()
    : result.jpeg({ quality: 92 }).toBuffer();
}
