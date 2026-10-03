import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALERT_MIN_SCORE,
  defaultSelectedTargetIds,
  isImplausibleListingPrice,
} from './alert-defaults';

describe('defaultSelectedTargetIds', () => {
  it('pre-checks only targets at or above the threshold', () => {
    expect(DEFAULT_ALERT_MIN_SCORE).toBe(80);
    expect(
      defaultSelectedTargetIds([
        { id: 'a', score: 100 },
        { id: 'b', score: 80 },
        { id: 'c', score: 79 },
        { id: 'd', score: 65 },
        { id: 'e', score: null },
      ])
    ).toEqual(['a', 'b']);
  });

  it('selects nothing when every target is weak', () => {
    expect(defaultSelectedTargetIds([{ id: 'a', score: 40 }])).toEqual([]);
    expect(defaultSelectedTargetIds([])).toEqual([]);
  });
});

describe('isImplausibleListingPrice', () => {
  it('flags a sale listing priced under one lakh', () => {
    expect(
      isImplausibleListingPrice({ price: 40_000, listing_type: 'Sale' })
    ).toBe(true);
    expect(
      isImplausibleListingPrice({ price: 99_999, listing_type: 'Sale' })
    ).toBe(true);
    expect(
      isImplausibleListingPrice({ price: 100_000, listing_type: 'Sale' })
    ).toBe(false);
    expect(
      isImplausibleListingPrice({ price: 45_00_000, listing_type: 'Sale' })
    ).toBe(false);
  });

  it('leaves rent and deal-term listings alone', () => {
    expect(
      isImplausibleListingPrice({ price: 8_000, listing_type: 'Rent' })
    ).toBe(false);
    expect(
      isImplausibleListingPrice({ price: 5_000, listing_type: 'JV/JD' })
    ).toBe(false);
    expect(
      isImplausibleListingPrice({ price: 5_000, listing_type: 'Built to Suit' })
    ).toBe(false);
  });

  it('flags only prices under ten thousand when the listing type is unknown', () => {
    expect(isImplausibleListingPrice({ price: 9_999 })).toBe(true);
    expect(
      isImplausibleListingPrice({ price: '5000', listing_type: null })
    ).toBe(true);
    expect(isImplausibleListingPrice({ price: 40_000 })).toBe(false);
  });

  it('does not flag a missing price', () => {
    expect(isImplausibleListingPrice({ price: 0, listing_type: 'Sale' })).toBe(
      false
    );
    expect(
      isImplausibleListingPrice({ price: null, listing_type: 'Sale' })
    ).toBe(false);
    expect(isImplausibleListingPrice({ price: 'abc' })).toBe(false);
  });
});
