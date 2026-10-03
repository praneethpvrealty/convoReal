import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALERT_MIN_SCORE,
  defaultSelectedTargetIds,
  isImplausibleListingPrice,
} from './radar-alerts';

describe('radar alert defaults', () => {
  it('pre-checks only targets scoring 80% or more', () => {
    expect(DEFAULT_ALERT_MIN_SCORE).toBe(80);
    expect(
      defaultSelectedTargetIds([
        { id: 'a', score: 100 },
        { id: 'b', score: 80 },
        { id: 'c', score: 65 },
      ])
    ).toEqual(['a', 'b']);
  });

  it('flags a sale listing under one lakh and an untyped one under ten thousand', () => {
    expect(
      isImplausibleListingPrice({ price: 40_000, listing_type: 'Sale' })
    ).toBe(true);
    expect(
      isImplausibleListingPrice({ price: 8_000, listing_type: 'Rent' })
    ).toBe(false);
    expect(isImplausibleListingPrice({ price: 9_000 })).toBe(true);
    expect(isImplausibleListingPrice({ price: 40_000 })).toBe(false);
    expect(isImplausibleListingPrice({ price: 0, listing_type: 'Sale' })).toBe(
      false
    );
  });
});
