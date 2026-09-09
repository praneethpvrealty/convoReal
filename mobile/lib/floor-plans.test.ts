import { describe, expect, it } from 'vitest';

import {
  isPlanPdf,
  LAND_SKETCH_MIME_TYPES,
  plansWithImages,
} from './floor-plans';

describe('plansWithImages', () => {
  it('returns only floor plans that carry an image', () => {
    const plans = [
      { floor: 'Ground', image: 'property-images/ground.jpg' },
      { floor: 'First', image: null },
      { floor: 'Second', image: 'https://example.com/second.jpg' },
    ];

    expect(plansWithImages(plans)).toEqual([plans[0], plans[2]]);
  });

  it('returns an empty list for missing plans', () => {
    expect(plansWithImages(null)).toEqual([]);
    expect(plansWithImages(undefined)).toEqual([]);
  });

  it('preserves the complete caller-owned shape', () => {
    const plan = {
      floor: 'Typical',
      image: 'typical.jpg',
      area_sqft: 1200,
      notes: 'Three-bedroom layout',
    };

    expect(plansWithImages([plan])).toEqual([plan]);
  });
});

describe('isPlanPdf', () => {
  it('recognises local and remote PDF sketch paths', () => {
    expect(isPlanPdf('property-documents/acc/sketch.pdf')).toBe(true);
    expect(isPlanPdf('https://cdn.example.com/layout.PDF?download=1')).toBe(
      true
    );
  });

  it('does not classify images as PDFs', () => {
    expect(isPlanPdf('property-images/acc/sketch.jpg')).toBe(false);
    expect(isPlanPdf(undefined)).toBe(false);
  });
});

describe('land sketch file types', () => {
  it('offers both PDFs and images in the native document picker', () => {
    expect(LAND_SKETCH_MIME_TYPES).toContain('application/pdf');
    expect(LAND_SKETCH_MIME_TYPES).toContain('image/jpeg');
  });
});
