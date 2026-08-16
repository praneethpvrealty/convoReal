import { describe, it, expect } from 'vitest';
import {
  sanitizeFloorPlans,
  sanitizeFloorPlanImage,
  plansWithImages,
  attachPlanImages,
  type FloorPlan,
} from './floor-plans';

const plan = (over: Partial<FloorPlan> = {}): FloorPlan => ({
  floor: 'Ground Floor',
  image: null,
  area_sqft: null,
  notes: null,
  ...over,
});

describe('sanitizeFloorPlans', () => {
  it('returns [] for anything that is not an array', () => {
    expect(sanitizeFloorPlans(null)).toEqual([]);
    expect(sanitizeFloorPlans('Ground Floor')).toEqual([]);
    expect(sanitizeFloorPlans({ floor: 'Ground' })).toEqual([]);
  });

  it('keeps a floor that has only a label', () => {
    const [row] = sanitizeFloorPlans([{ floor: 'First Floor' }]);
    expect(row).toEqual({
      floor: 'First Floor',
      image: null,
      area_sqft: null,
      notes: null,
      page: null,
    });
  });

  it('keeps a floor that has only a drawing', () => {
    const rows = sanitizeFloorPlans([
      { image: 'property-images/acc-1/img-1.jpg' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].image).toBe('property-images/acc-1/img-1.jpg');
  });

  it('drops rows carrying neither a label nor a drawing', () => {
    expect(sanitizeFloorPlans([{ area_sqft: 1200, notes: 'orphan' }])).toEqual(
      []
    );
  });

  it('rejects a negative area rather than storing it', () => {
    expect(
      sanitizeFloorPlans([{ floor: 'G', area_sqft: -5 }])[0].area_sqft
    ).toBeNull();
  });

  it('bounds the number of floors', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      floor: `Floor ${i}`,
    }));
    expect(sanitizeFloorPlans(many)).toHaveLength(60);
  });

  it('truncates an overlong floor label', () => {
    expect(
      sanitizeFloorPlans([{ floor: 'x'.repeat(500) }])[0].floor
    ).toHaveLength(80);
  });
});

describe('sanitizeFloorPlanImage', () => {
  it('keeps a bucket-relative storage path', () => {
    expect(sanitizeFloorPlanImage('property-images/acc/img-1.jpg')).toBe(
      'property-images/acc/img-1.jpg'
    );
  });

  it('keeps an absolute https URL', () => {
    expect(sanitizeFloorPlanImage('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    );
  });

  it('refuses a data: payload', () => {
    expect(
      sanitizeFloorPlanImage('data:image/svg+xml;base64,PHN2Zz4=')
    ).toBeNull();
  });

  it('refuses a javascript: scheme', () => {
    expect(sanitizeFloorPlanImage('javascript:alert(1)')).toBeNull();
  });

  it('returns null for a blank or non-string value', () => {
    expect(sanitizeFloorPlanImage('   ')).toBeNull();
    expect(sanitizeFloorPlanImage(42)).toBeNull();
  });
});

describe('attachPlanImages', () => {
  it('matches a drawing to the floor printed on the same page', () => {
    const result = attachPlanImages(
      [plan({ floor: 'Ground', page: 3 }), plan({ floor: 'First', page: 4 })],
      [
        { url: 'img/first.jpg', page: 4 },
        { url: 'img/ground.jpg', page: 3 },
      ]
    );
    expect(result[0].image).toBe('img/ground.jpg');
    expect(result[1].image).toBe('img/first.jpg');
  });

  it('never gives one drawing to two floors', () => {
    const result = attachPlanImages(
      [plan({ floor: 'Ground', page: 2 }), plan({ floor: 'First', page: 2 })],
      [{ url: 'img/only.jpg', page: 2 }]
    );
    expect(result[0].image).toBe('img/only.jpg');
    expect(result[1].image).toBeNull();
  });

  it('falls back to document order when pages are unknown', () => {
    const result = attachPlanImages(
      [plan({ floor: 'Ground' }), plan({ floor: 'First' })],
      [
        { url: 'img/a.jpg', page: 1 },
        { url: 'img/b.jpg', page: 2 },
      ]
    );
    expect(result.map((p) => p.image)).toEqual(['img/a.jpg', 'img/b.jpg']);
  });

  it('leaves a floor empty rather than borrowing another floor plan', () => {
    const result = attachPlanImages([plan({ floor: 'Ground' })], []);
    expect(result[0].image).toBeNull();
  });

  it('does not disturb a floor that already has a drawing', () => {
    const result = attachPlanImages(
      [plan({ floor: 'Ground', image: 'img/kept.jpg', page: 1 })],
      [{ url: 'img/new.jpg', page: 1 }]
    );
    expect(result[0].image).toBe('img/kept.jpg');
  });

  it('prefers the page match over document order', () => {
    const result = attachPlanImages(
      [plan({ floor: 'Second', page: 9 })],
      [
        { url: 'img/early.jpg', page: 2 },
        { url: 'img/second.jpg', page: 9 },
      ]
    );
    expect(result[0].image).toBe('img/second.jpg');
  });
});

describe('plansWithImages', () => {
  it('keeps only floors that carry a drawing', () => {
    const rows = plansWithImages([
      plan({ floor: 'Ground', image: 'img/a.jpg' }),
      plan({ floor: 'First' }),
    ]);
    expect(rows.map((r) => r.floor)).toEqual(['Ground']);
  });

  it('tolerates a null column', () => {
    expect(plansWithImages(null)).toEqual([]);
  });
});
