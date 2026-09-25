import { describe, it, expect } from 'vitest';
import {
  CLOSED_LISTING_STATUSES,
  CLOSED_LISTING_STATUS_FILTER,
  isListingClosed,
  listingAvailabilityNotice,
  listingStatusInquiryLine,
  appendListingStatusNote,
  listingStatusAgentLine,
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

describe('listingAvailabilityNotice', () => {
  it('[PRP-014] stays silent for an available listing', () => {
    expect(listingAvailabilityNotice('Available')).toBeNull();
    expect(listingAvailabilityNotice(null)).toBeNull();
    expect(listingAvailabilityNotice('')).toBeNull();
  });

  it('[PRP-014] tells an enquirer an under-contract listing can still be checked with the owner', () => {
    const notice = listingAvailabilityNotice('Under Contract');
    expect(notice?.label).toBe('Under contract');
    expect(notice?.message).toMatch(/under contract/);
    expect(notice?.message).toMatch(/not closed/);
    expect(notice?.message).toMatch(/check with the listing owner/);
  });

  it('[PRP-014] explains every non-available status the editor can set', () => {
    for (const status of PROPERTY_STATUSES.filter((s) => s !== 'Available')) {
      const notice = listingAvailabilityNotice(status);
      expect(notice, status).not.toBeNull();
      expect(notice?.message).toMatch(/check with the listing owner/);
      expect(notice?.label).not.toBe('');
    }
  });

  it('falls back to the stored status for one it does not know', () => {
    const notice = listingAvailabilityNotice('Rented');
    expect(notice?.label).toBe('Rented');
    expect(notice?.message).toContain('marked rented');
  });
});

describe('listingStatusInquiryLine', () => {
  it('[PRP-014] asks for the latest status only when the listing is not available', () => {
    expect(listingStatusInquiryLine('Available')).toBeNull();
    expect(listingStatusInquiryLine('Under Contract')).toBe(
      'I see it is marked "Under Contract" — could you share its latest status?'
    );
  });
});

describe('appendListingStatusNote', () => {
  it('[PRP-014] leaves an available listing acknowledgement untouched', () => {
    expect(appendListingStatusNote('Thanks!', 'Available')).toBe('Thanks!');
  });

  it('[PRP-014] warns a WhatsApp enquirer that the listing is under contract', () => {
    const text = appendListingStatusNote('Thanks!', 'Under Contract');
    expect(text.startsWith('Thanks!\n\nPlease note:')).toBe(true);
    expect(text).toMatch(/under contract/);
    expect(text).toMatch(/latest status with the owner/);
  });
});

describe('listingStatusAgentLine', () => {
  it('[PRP-014] warns the agent before a visit is promised on an unavailable listing', () => {
    expect(listingStatusAgentLine('Available')).toBeNull();
    expect(listingStatusAgentLine('Sold')).toContain('marked "Sold"');
  });
});
