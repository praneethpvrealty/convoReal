import { describe, expect, it } from 'vitest';
import { listingCardStatus } from './card-badges';

describe('listingCardStatus', () => {
  it('[PRP-039] says nothing for an available listing', () => {
    expect(listingCardStatus('Available')).toBeNull();
    expect(listingCardStatus(null)).toBeNull();
    expect(listingCardStatus(undefined)).toBeNull();
  });

  it('[PRP-039] names every other status', () => {
    for (const status of [
      'Under Contract',
      'Sold',
      'Off Market',
      'Pending Review',
      'Rejected',
      'Archived',
    ]) {
      expect(listingCardStatus(status)).toBe(status);
    }
  });
});
