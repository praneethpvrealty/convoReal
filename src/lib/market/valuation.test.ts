import { describe, expect, it } from 'vitest';

import {
  MIN_MARKET_COMPARABLES,
  marketLookbackStart,
  marketPlacement,
  marketRange,
  placementKey,
  type MarketRateCell,
} from './valuation';

const cell = (over: Partial<MarketRateCell> = {}): MarketRateCell => ({
  period_month: '2026-10-01',
  city: 'bengaluru',
  locality: 'whitefield',
  property_type: 'apartment',
  priced_count: 8,
  median_price_per_sqft: 9000,
  p25_price_per_sqft: 8000,
  p75_price_per_sqft: 10500,
  ...over,
});

describe('marketRange', () => {
  it('[PVL-002] multiplies the area by the cell quartiles', () => {
    expect(marketRange(1200, [cell()])).toEqual({
      low: 9_600_000,
      mid: 10_800_000,
      high: 12_600_000,
      rate_per_sqft: 9000,
      comparables: 8,
      period_month: '2026-10-01',
    });
  });

  it('[PVL-002] gives no range below the comparables floor', () => {
    expect(
      marketRange(1200, [cell({ priced_count: MIN_MARKET_COMPARABLES - 1 })])
    ).toBeNull();
    expect(marketRange(1200, [cell({ priced_count: null })])).toBeNull();
    expect(
      marketRange(1200, [cell({ median_price_per_sqft: null })])
    ).toBeNull();
    expect(marketRange(1200, [])).toBeNull();
  });

  it('[PVL-002] gives no range without an area', () => {
    expect(marketRange(null, [cell()])).toBeNull();
    expect(marketRange(0, [cell()])).toBeNull();
  });

  it('[PVL-002] uses the newest month that clears the floor', () => {
    const range = marketRange(1000, [
      cell({ period_month: '2026-09-01', median_price_per_sqft: 7000 }),
      cell({ period_month: '2026-11-01', priced_count: 2 }),
      cell({ period_month: '2026-10-01', median_price_per_sqft: 9000 }),
    ]);
    expect(range?.period_month).toBe('2026-10-01');
    expect(range?.mid).toBe(9_000_000);
  });

  it('[PVL-002] reads numeric strings and falls back to the median for a missing quartile', () => {
    const range = marketRange(1000, [
      cell({
        priced_count: '6' as unknown as number,
        median_price_per_sqft: '9000' as unknown as number,
        p25_price_per_sqft: null,
        p75_price_per_sqft: null,
      }),
    ]);
    expect(range).toMatchObject({
      low: 9_000_000,
      mid: 9_000_000,
      high: 9_000_000,
      comparables: 6,
    });
  });
});

describe('marketPlacement', () => {
  it('[PVL-005] places a property on the same key the engine writes', () => {
    const placement = marketPlacement({
      city: 'Bangalore',
      sublocality: 'Whitefield ',
      locality_canonical: null,
      type: 'Apartment',
    });
    expect(placement && placementKey(placement)).toBe(
      'bengaluru|whitefield|apartment'
    );
    expect(
      marketPlacement({ city: 'Bangalore', sublocality: null, type: 'Villa' })
    ).toBeNull();
  });

  it('looks back six month buckets', () => {
    expect(marketLookbackStart(new Date('2026-11-11T00:00:00Z'))).toBe(
      '2026-06-01'
    );
  });
});
