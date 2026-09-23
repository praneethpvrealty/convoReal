import { describe, expect, it } from 'vitest';
import { buildAreaNearMissLine, findAreaNearMiss } from './area-near-misses';

const suryanagarPlot = {
  id: 'p1',
  title: 'North facing 50x80 Semi-Commercial Plot in Suryanagar Phase 1',
  price: 60_000_000,
  listing_type: 'Sale' as const,
  sublocality: 'Suryanagar phase 1',
};
const suryaCityPlot = {
  id: 'p2',
  title: '3933 Sq.Ft. North East corner Residential Plot in Surya city phase 3',
  price: 24_000_000,
  listing_type: 'Sale' as const,
  location: 'Surya city phase 3, Bangalore, Karnataka',
};
const suryaCityRental = {
  id: 'p3',
  title: 'Shop for rent in Surya City',
  price: 40_000,
  listing_type: 'Rent' as const,
  location: 'Surya City, Chandapura',
};

describe('findAreaNearMiss', () => {
  it("[INB-015] finds the lead's own locality at any price, cheapest first, same deal type only", () => {
    const nearMiss = findAreaNearMiss(
      [suryanagarPlot, suryaCityRental, suryaCityPlot] as never,
      { areas: ['KHB Suryanagar Phase'], listingTypes: ['Sale'] }
    );
    expect(nearMiss?.properties.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(nearMiss?.minPrice).toBe(24_000_000);
    expect(nearMiss?.maxPrice).toBe(60_000_000);
  });

  it('returns null when the areas hold no live stock', () => {
    expect(
      findAreaNearMiss([suryanagarPlot] as never, {
        areas: ['Whitefield'],
        listingTypes: ['Sale'],
      })
    ).toBeNull();
  });
});

describe('buildAreaNearMissLine', () => {
  const nearMiss = findAreaNearMiss([suryanagarPlot, suryaCityPlot] as never, {
    areas: ['KHB Suryanagar Phase'],
    listingTypes: [],
  })!;

  it('[INB-015] states the count, the price band and that it is above budget', () => {
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: 3_000_000, budgetMax: 3_500_000 },
        'https://x.test/?ids=P1,P2'
      )
    ).toBe(
      '📍 We do have 2 listings in KHB Suryanagar Phase, at ₹2.4 Cr–₹6 Cr — above your budget. Take a look: https://x.test/?ids=P1,P2'
    );
  });

  it('says nothing about budget when none is known', () => {
    expect(
      buildAreaNearMissLine(
        nearMiss,
        { budgetMin: null, budgetMax: null },
        'https://x.test'
      )
    ).not.toContain('budget');
  });
});
