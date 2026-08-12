import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { watermarkImage, watermarkLabel } from '@/lib/storage/watermark';

async function solidJpeg(width = 300, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 30, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('watermarkLabel', () => {
  it('leads with the viewer so they recognise their own copy', () => {
    expect(
      watermarkLabel({ viewerLabel: '98•••••210', reference: 'A1B2C3D4' })
    ).toBe('98•••••210 · A1B2C3D4');
  });

  it('still stamps a reference for an unattributed generic-link grant', () => {
    expect(watermarkLabel({ viewerLabel: null, reference: 'A1B2C3D4' })).toBe(
      'Confidential · A1B2C3D4'
    );
    expect(watermarkLabel({ viewerLabel: '  ', reference: 'X' })).toBe(
      'Confidential · X'
    );
  });
});

describe('watermarkImage', () => {
  it('returns a JPEG of the same dimensions', async () => {
    const { buffer, contentType } = await watermarkImage(
      await solidJpeg(),
      'test · ABC'
    );
    expect(contentType).toBe('image/jpeg');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  // "The bytes changed" is not the invariant — re-encoding a JPEG
  // changes bytes on its own. Production served an image that differed
  // from the stored original and was pixel-identical to a plain
  // re-encode: the overlay drew nothing, and the earlier version of
  // this test passed anyway. Compare against a plain re-encode so only
  // the overlay can account for the difference.
  it('actually marks the pixels, not just the bytes', async () => {
    const original = await solidJpeg();
    const plain = await sharp(original)
      .rotate()
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const { buffer } = await watermarkImage(original, 'test · ABC');

    const [a, b] = await Promise.all([
      sharp(plain).raw().toBuffer({ resolveWithObject: true }),
      sharp(buffer).raw().toBuffer({ resolveWithObject: true }),
    ]);
    expect(b.info.width).toBe(a.info.width);

    let changed = 0;
    for (let i = 0; i < a.data.length; i++) {
      if (Math.abs(a.data[i] - b.data[i]) > 12) changed++;
    }
    // A tiled overlay across a 300x200 image marks thousands of
    // subpixels; a no-op marks zero.
    expect(changed, 'overlay drew nothing').toBeGreaterThan(1000);
  });

  it('marks a dark image too — the mark must not depend on the photo', async () => {
    const dark = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 20, g: 30, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();
    const plain = await sharp(dark)
      .rotate()
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const { buffer } = await watermarkImage(dark, '98•••••210 · A1B2C3D4');
    const [a, b] = await Promise.all([
      sharp(plain).raw().toBuffer(),
      sharp(buffer).raw().toBuffer(),
    ]);
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 12) changed++;
    }
    expect(changed).toBeGreaterThan(1000);
  });

  it('does not break on label text that would corrupt the SVG overlay', async () => {
    const { buffer } = await watermarkImage(
      await solidJpeg(),
      '<script>&"\'</script> · ABC'
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(300);
  });

  it('serves the original rather than failing a legitimate reveal', async () => {
    const notAnImage = Buffer.from('definitely not an image');
    const { buffer } = await watermarkImage(notAnImage, 'test');
    expect(buffer.equals(notAnImage)).toBe(true);
  });
});
