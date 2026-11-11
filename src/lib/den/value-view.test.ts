import { describe, expect, it } from 'vitest';

import {
  MAX_DECLARED_VALUE,
  buildPropertyValue,
  isStillOwned,
  missingValueMessage,
  parseDeclaredValue,
  portfolioTotals,
  valuedSummary,
} from './value-view';

const market = {
  low: 9_000_000,
  mid: 10_000_000,
  high: 11_000_000,
  rate_per_sqft: 10_000,
  comparables: 6,
  period_month: '2026-10-01',
};

const base = {
  property_id: 'p1',
  title: 'Flat',
  agency_name: 'Acme',
  listing_type: 'Sale',
  price: null,
  declared: null,
  guidance: null,
  market: null,
};

describe('buildPropertyValue', () => {
  it("[PVL-001] counts the owner's own value before any other source", () => {
    const value = buildPropertyValue({
      ...base,
      price: 12_000_000,
      declared: 13_000_000,
      guidance: { total: 6_000_000, saved_at: null },
      market,
    });
    expect(value.estimate).toBe(13_000_000);
    expect(value.estimate_source).toBe('declared');
    expect(value.asking).toBe(12_000_000);
    expect(value.guidance?.total).toBe(6_000_000);
    expect(value.market).toEqual(market);
  });

  it('[PVL-001] falls back to expected price, then market, then guidance', () => {
    expect(
      buildPropertyValue({ ...base, price: 12_000_000, market })
    ).toMatchObject({ estimate: 12_000_000, estimate_source: 'asking' });
    expect(
      buildPropertyValue({
        ...base,
        market,
        guidance: { total: 6_000_000, saved_at: null },
      })
    ).toMatchObject({ estimate: 10_000_000, estimate_source: 'market' });
    expect(
      buildPropertyValue({
        ...base,
        guidance: { total: 6_000_000, saved_at: null },
      })
    ).toMatchObject({ estimate: 6_000_000, estimate_source: 'guidance' });
  });

  it('[PVL-001] never invents a value when no source has one', () => {
    expect(buildPropertyValue(base)).toMatchObject({
      estimate: null,
      estimate_source: null,
    });
  });

  it('[PVL-001] never treats a rent figure as the value of a let property', () => {
    expect(
      buildPropertyValue({ ...base, listing_type: 'Rent', price: 45_000 })
    ).toMatchObject({ asking: null, estimate: null });
  });
});

describe('portfolioTotals', () => {
  it('[PVL-001] sums each source separately and reports how many are valued', () => {
    const totals = portfolioTotals([
      buildPropertyValue({ ...base, declared: 13_000_000, market }),
      buildPropertyValue({
        ...base,
        property_id: 'p2',
        guidance: { total: 6_000_000, saved_at: null },
      }),
      buildPropertyValue({ ...base, property_id: 'p3' }),
    ]);
    expect(totals).toEqual({
      properties: 3,
      valued: 2,
      estimate: 19_000_000,
      guidance: 6_000_000,
      guidance_count: 1,
      market_low: 9_000_000,
      market_high: 11_000_000,
      market_count: 1,
    });
    expect(valuedSummary(totals)).toBe('From 2 of 3 properties');
    expect(valuedSummary(portfolioTotals([]))).toBe('No properties yet');
  });
});

describe('isStillOwned', () => {
  it('[PVL-003] drops a sold property but keeps a let one', () => {
    expect(isStillOwned('Available', 'Sale')).toBe(true);
    expect(isStillOwned('Sold', 'Sale')).toBe(false);
    expect(isStillOwned('Sold', null)).toBe(false);
    expect(isStillOwned('Sold', 'Rent')).toBe(true);
    expect(isStillOwned('Sold', 'Built to Suit')).toBe(true);
    expect(missingValueMessage('Sold', 'Sale')).toContain('sold property');
    expect(missingValueMessage('Available', 'Sale')).toContain('older');
  });
});

describe('parseDeclaredValue', () => {
  it('[PVL-003] accepts a positive rupee amount or null and refuses the rest', () => {
    expect(parseDeclaredValue(8_500_000.4)).toBe(8_500_000);
    expect(parseDeclaredValue(null)).toBeNull();
    expect(parseDeclaredValue(0)).toBeUndefined();
    expect(parseDeclaredValue(-5)).toBeUndefined();
    expect(parseDeclaredValue('8500000')).toBeUndefined();
    expect(parseDeclaredValue(Number.NaN)).toBeUndefined();
    expect(parseDeclaredValue(MAX_DECLARED_VALUE + 1)).toBeUndefined();
    expect(parseDeclaredValue(undefined)).toBeUndefined();
  });
});
