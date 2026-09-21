import { describe, expect, it } from 'vitest';
import { looksLikeDocument, orderForCover, samplePixels } from './cover-photo';

function frame(pixels: [number, number, number][]): number[] {
  return pixels.flatMap(([r, g, b]) => [r, g, b, 255]);
}

describe('cover photo classifier', () => {
  it('reads a scanned letter as a document', () => {
    const scan = frame([
      ...Array.from(
        { length: 80 },
        () => [245, 244, 240] as [number, number, number]
      ),
      ...Array.from(
        { length: 20 },
        () => [30, 30, 32] as [number, number, number]
      ),
    ]);
    const sample = samplePixels(scan);
    expect(sample.paperShare).toBeCloseTo(0.8);
    expect(sample.greyShare).toBe(1);
    expect(looksLikeDocument(sample)).toBe(true);
  });

  it('keeps a photograph of a plot as a photo', () => {
    const plot = frame([
      ...Array.from(
        { length: 50 },
        () => [92, 140, 60] as [number, number, number]
      ),
      ...Array.from(
        { length: 30 },
        () => [120, 170, 230] as [number, number, number]
      ),
      ...Array.from(
        { length: 20 },
        () => [160, 130, 100] as [number, number, number]
      ),
    ]);
    expect(looksLikeDocument(samplePixels(plot))).toBe(false);
  });

  it('keeps a bright white-walled interior as a photo', () => {
    const interior = frame([
      ...Array.from(
        { length: 60 },
        () => [236, 232, 225] as [number, number, number]
      ),
      ...Array.from(
        { length: 25 },
        () => [150, 110, 70] as [number, number, number]
      ),
      ...Array.from(
        { length: 15 },
        () => [90, 120, 160] as [number, number, number]
      ),
    ]);
    const sample = samplePixels(interior);
    expect(sample.greyShare).toBeLessThan(0.85);
    expect(looksLikeDocument(sample)).toBe(false);
  });

  it('treats an empty frame as a photo', () => {
    expect(looksLikeDocument(samplePixels([]))).toBe(false);
  });

  it('puts documents after photos without reordering either group', () => {
    const ordered = orderForCover(
      ['doc-1', 'photo-1', 'doc-2', 'photo-2'],
      (name) => name.startsWith('doc')
    );
    expect(ordered).toEqual(['photo-1', 'photo-2', 'doc-1', 'doc-2']);
  });
});
