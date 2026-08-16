import { describe, it, expect } from 'vitest';
import { deflateSync } from 'zlib';
import sharp from 'sharp';
import { extractPdfImageAssets, extractImagesFromPdf } from './image-extractor';

const W = 300;
const H = 300;

function pdfObject(dict: string, stream: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`1 0 obj\n${dict}\nstream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
}

function assemble(...parts: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), ...parts]);
}

function page(): Buffer {
  return Buffer.from('2 0 obj\n<< /Type /Page >>\nendobj\n', 'latin1');
}

/** Raw RGB, uniform colour, no predictor. */
function flateImage(r: number, g: number, b: number): Buffer {
  const raw = Buffer.alloc(W * H * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
  }
  return pdfObject(
    `<< /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
    deflateSync(raw)
  );
}

async function jpegImage(): Promise<Buffer> {
  const jpeg = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 20, g: 90, b: 160 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  // Padded past the 20 KB floor the JPEG path uses to skip logos.
  const padded = Buffer.concat([jpeg, Buffer.alloc(25000)]);
  return pdfObject(
    `<< /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
    padded
  );
}

describe('extractPdfImageAssets', () => {
  it('extracts a FlateDecode image, which the JPEG-only scan skipped', async () => {
    const assets = await extractPdfImageAssets(
      assemble(flateImage(250, 250, 250))
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].width).toBe(W);
    expect(assets[0].height).toBe(H);
    // Re-encoded to JPEG, so it is uploadable as an ordinary photo.
    expect(assets[0].buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('flags near-white low-saturation art as a floor plan candidate', async () => {
    const [plan] = await extractPdfImageAssets(
      assemble(flateImage(248, 248, 248))
    );
    expect(plan.isLineArt).toBe(true);
  });

  it('does not flag a saturated photograph as line art', async () => {
    const [photo] = await extractPdfImageAssets(
      assemble(flateImage(30, 110, 60))
    );
    expect(photo.isLineArt).toBe(false);
  });

  it('still extracts DCTDecode photographs', async () => {
    const assets = await extractPdfImageAssets(assemble(await jpegImage()));
    expect(assets).toHaveLength(1);
    expect(assets[0].buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('attributes images to the page they follow', async () => {
    const pdf = assemble(
      page(),
      flateImage(250, 250, 250),
      page(),
      flateImage(40, 80, 160)
    );
    const assets = await extractPdfImageAssets(pdf);
    expect(assets.map((a) => a.page)).toEqual([1, 2]);
  });

  it('skips images too small to be a plan or a photo', async () => {
    const raw = Buffer.alloc(10 * 10 * 3, 200);
    const tiny = pdfObject(
      '<< /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>',
      deflateSync(raw)
    );
    expect(await extractPdfImageAssets(assemble(tiny))).toHaveLength(0);
  });

  it('skips a palette colour space rather than guessing its channels', async () => {
    const indexed = pdfObject(
      `<< /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /Indexed /BitsPerComponent 8 /Filter /FlateDecode >>`,
      deflateSync(Buffer.alloc(W * H, 128))
    );
    expect(await extractPdfImageAssets(assemble(indexed))).toHaveLength(0);
  });

  it('survives a corrupt stream without losing the rest of the file', async () => {
    const broken = pdfObject(
      `<< /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
      Buffer.from('not actually deflate data', 'latin1')
    );
    const assets = await extractPdfImageAssets(
      assemble(broken, flateImage(250, 250, 250))
    );
    expect(assets).toHaveLength(1);
  });

  it('extractImagesFromPdf still returns bare buffers', async () => {
    const buffers = await extractImagesFromPdf(
      assemble(flateImage(250, 250, 250))
    );
    expect(buffers).toHaveLength(1);
    expect(Buffer.isBuffer(buffers[0])).toBe(true);
  });
});
