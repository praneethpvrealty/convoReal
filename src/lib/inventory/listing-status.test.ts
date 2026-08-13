import { describe, it, expect } from 'vitest';
import {
  CLOSED_LISTING_STATUSES,
  CLOSED_LISTING_STATUS_FILTER,
  isListingClosed,
} from './listing-status';
import { PROPERTY_STATUSES } from './property-options';

describe('CLOSED_LISTING_STATUS_FILTER', () => {
  it('quotes every status so the multi-word ones survive PostgREST parsing', () => {
    expect(CLOSED_LISTING_STATUS_FILTER).toBe(
      '("Sold","Off Market","Archived","Rejected")'
    );
  });

  it('names statuses the property editor can actually set', () => {
    for (const status of CLOSED_LISTING_STATUSES) {
      expect(PROPERTY_STATUSES).toContain(status);
    }
  });
});

describe('isListingClosed', () => {
  it('keeps listings that are still in play', () => {
    expect(isListingClosed('Available')).toBe(false);
    expect(isListingClosed('Under Contract')).toBe(false);
    expect(isListingClosed(null)).toBe(false);
  });

  it('closes the ones that have left the market', () => {
    expect(isListingClosed('Sold')).toBe(true);
    expect(isListingClosed('Off Market')).toBe(true);
  });
});
