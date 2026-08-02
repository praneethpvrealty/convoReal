import { describe, expect, it } from 'vitest';
import {
  buildLocalityRows,
  cityOptions,
  marketMonths,
  pctDelta,
  priceTrend,
  titleCaseToken,
  type MarketDemandCell,
  type MarketSupplyCell,
  type OwnLocalityMedian,
} from './view';

function supplyCell(overrides: Partial<MarketSupplyCell>): MarketSupplyCell {
  return {
    period_month: '2026-07-01',
    city: 'bengaluru',
    locality: 'whitefield',
    property_type: 'apartment',
    listing_type: 'sale',
    listings_count: 10,
    median_price: 9000000,
    median_area_sqft: 1200,
    sold_count: 2,
    median_sold_price: 8800000,
    median_days_to_sell: 45,
    accounts_count: 6,
    ...overrides,
  };
}

function demandCell(overrides: Partial<MarketDemandCell>): MarketDemandCell {
  return {
    period_month: '2026-07-01',
    locality: 'whitefield',
    property_type: 'apartment',
    buyer_count: 14,
    median_budget: 8500000,
    accounts_count: 6,
    ...overrides,
  };
}

function ownMedian(overrides: Partial<OwnLocalityMedian>): OwnLocalityMedian {
  return {
    city: 'bengaluru',
    locality: 'whitefield',
    property_type: 'apartment',
    listing_type: 'sale',
    listings_count: 3,
    median_price: 9900000,
    median_area_sqft: 1150,
    ...overrides,
  };
}

describe('buildLocalityRows', () => {
  it('merges supply, demand and own medians for one city and month', () => {
    const rows = buildLocalityRows(
      {
        supply: [
          supplyCell({}),
          supplyCell({
            locality: 'hsr layout',
            listings_count: 4,
            median_price: 12000000,
          }),
          supplyCell({ city: 'pune', locality: 'baner' }),
          supplyCell({ period_month: '2026-06-01', listings_count: 99 }),
        ],
        demand: [demandCell({})],
        own: [ownMedian({})],
      },
      'bengaluru',
      '2026-07-01'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].locality).toBe('whitefield');
    expect(rows[0].buyers).toBe(14);
    expect(rows[0].yourListings).toBe(3);
    expect(rows[0].priceDeltaPct).toBeCloseTo(10);
    expect(rows[1].locality).toBe('hsr layout');
    expect(rows[1].buyers).toBe(0);
    expect(rows[1].yourMedianPrice).toBeNull();
  });

  it("falls back to the 'any' property type for demand matching", () => {
    const rows = buildLocalityRows(
      {
        supply: [supplyCell({ property_type: 'villa' })],
        demand: [demandCell({ property_type: 'any', buyer_count: 5 })],
        own: [],
      },
      'bengaluru',
      '2026-07-01'
    );
    expect(rows[0].buyers).toBe(5);
  });

  it('uses the latest demand snapshot per locality/type', () => {
    const rows = buildLocalityRows(
      {
        supply: [supplyCell({})],
        demand: [
          demandCell({ period_month: '2026-06-01', buyer_count: 3 }),
          demandCell({ period_month: '2026-07-01', buyer_count: 9 }),
        ],
        own: [],
      },
      'bengaluru',
      '2026-07-01'
    );
    expect(rows[0].buyers).toBe(9);
  });
});

describe('priceTrend', () => {
  it('returns the chronological series for one cell', () => {
    const trend = priceTrend(
      [
        supplyCell({ period_month: '2026-07-01', median_price: 9500000 }),
        supplyCell({ period_month: '2026-06-01', median_price: 9000000 }),
        supplyCell({ period_month: '2026-07-01', locality: 'hsr layout' }),
      ],
      'bengaluru',
      'whitefield|apartment|sale'
    );
    expect(trend.map((t) => t.month)).toEqual(['2026-06-01', '2026-07-01']);
    expect(trend[1].medianPrice).toBe(9500000);
  });
});

describe('helpers', () => {
  it('lists months and cities', () => {
    const supply = [
      supplyCell({ period_month: '2026-06-01' }),
      supplyCell({ period_month: '2026-07-01', city: 'pune' }),
    ];
    expect(marketMonths(supply)).toEqual(['2026-06-01', '2026-07-01']);
    expect(cityOptions(supply)).toEqual(['bengaluru', 'pune']);
  });

  it('computes percent deltas and title case', () => {
    expect(pctDelta(110, 100)).toBeCloseTo(10);
    expect(pctDelta(90, 100)).toBeCloseTo(-10);
    expect(pctDelta(100, 0)).toBeNull();
    expect(titleCaseToken('hsr layout')).toBe('Hsr Layout');
  });
});
