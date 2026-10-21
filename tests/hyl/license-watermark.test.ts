// @vitest-environment node
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { watermarkLicense } from '../../server/providers/license-watermark.js';

it.each(['image/png', 'image/jpeg'])(
  'burns a repeated watermark into %s without altering the original',
  async (mime) => {
    const image = sharp({
      create: { width: 1000, height: 800, channels: 3, background: 'white' },
    });
    const original = await (
      mime === 'image/png' ? image.png() : image.jpeg()
    ).toBuffer();
    const before = Buffer.from(original);
    const output = await watermarkLicense(original, mime);
    expect(original.equals(before)).toBe(true);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 800]);
    const { data } = await sharp(output)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // A blank white scan must acquire visible marks in each quadrant.
    for (const [left, top] of [
      [0, 0],
      [500, 0],
      [0, 400],
      [500, 400],
    ]) {
      let dark = 0;
      for (let y = top; y < top + 400; y++)
        for (let x = left; x < left + 500; x++)
          if (data[(y * 1000 + x) * 3] < 240) dark++;
      expect(dark).toBeGreaterThan(100);
    }
  },
);
it('watermarks every PDF page, including rotated pages', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([842, 595]).setRotation(degrees(90));
  const input = await pdf.save();
  const output = await PDFDocument.load(
    await watermarkLicense(input, 'application/pdf'),
  );
  expect(output.getPageCount()).toBe(2);
  for (const page of output.getPages())
    expect(page.node.Resources()?.has(PDFName.of('XObject'))).toBe(true);
});
it('refuses malformed, oversized or unsupported content instead of returning an original', async () => {
  await expect(
    watermarkLicense(Buffer.from('%PDF-broken'), 'application/pdf'),
  ).rejects.toThrow();
  await expect(
    watermarkLicense(Buffer.from('invalid'), 'image/png'),
  ).rejects.toThrow();
  await expect(
    watermarkLicense(Buffer.from('invalid'), 'image/svg+xml'),
  ).rejects.toThrow();
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 101; i++) pdf.addPage();
  await expect(
    watermarkLicense(await pdf.save(), 'application/pdf'),
  ).rejects.toThrow('Too many');
});
