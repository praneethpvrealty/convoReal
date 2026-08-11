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

  it('actually changes the pixels', async () => {
    const original = await solidJpeg();
    const { buffer } = await watermarkImage(original, 'test · ABC');
    expect(buffer.equals(original)).toBe(false);
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
