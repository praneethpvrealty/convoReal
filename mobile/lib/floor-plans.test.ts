import { describe, expect, it } from 'vitest';

import { plansWithImages } from './floor-plans';

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
