import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { fail } from '../hyl/service.js';
// Drawings keep their original bytes; decode once to reject corrupt or mislabeled uploads.
export async function validateAssetFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (
      file.type === 'application/pdf' &&
      /\.pdf$/i.test(file.name) &&
      new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
    ) {
      const pdf = await PDFDocument.load(bytes);
      if (!pdf.getPageCount()) throw new Error('Empty document');
      return;
    }
    const expected =
      file.type === 'image/png' && /\.png$/i.test(file.name)
        ? 'png'
        : file.type === 'image/jpeg' && /\.jpe?g$/i.test(file.name)
          ? 'jpeg'
          : undefined;
    if (expected) {
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000,
      }).metadata();
      if (metadata.format === expected && metadata.width && metadata.height)
        return;
    }
  } catch {
    fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
  }
  fail('PROFILE_FILE_TYPE', 'INVALID_ARGUMENT');
}
