import { describe, expect, it } from 'vitest';
import { listingCardStatus } from './card-badges';
import {
  listingAvailabilityNotice,
  listingStatusAgentLine,
  listingStatusNote,
  unavailableListingSharePrompt,
} from './listing-availability';
import {
  listingAvailabilityAnswer,
  unavailableListingReply,
} from './listing-status';
import { closedPriceLabel, listingStatusLabel } from './listing-status-label';

describe('[PRP-060] a closed let listing reads Rented or Leased, never Sold', () => {
  it('words the stored Sold status by listing type', () => {
    expect(listingStatusLabel('Sold', 'Rent')).toBe('Rented');
    expect(listingStatusLabel('Sold', 'Built to Suit')).toBe('Leased');
    expect(listingStatusLabel('Sold', 'Sale')).toBe('Sold');
    expect(listingStatusLabel('Sold', 'JV/JD')).toBe('Sold');
    expect(listingStatusLabel('Sold', null)).toBe('Sold');
  });

  it('leaves every other status alone', () => {
    for (const status of ['Available', 'Under Contract', 'Off Market']) {
      expect(listingStatusLabel(status, 'Rent')).toBe(status);
    }
  });

  it('badges the card and labels the closing price to match', () => {
    expect(listingCardStatus('Sold', 'Rent')).toBe('Rented');
    expect(listingCardStatus('Sold', 'Sale')).toBe('Sold');
    expect(closedPriceLabel('Rent')).toBe('Final rent / month');
    expect(closedPriceLabel('Built to Suit')).toBe('Final rent / month');
    expect(closedPriceLabel('Sale')).toBe('Final sale price');
  });

  it('never tells a tenant the property was sold', () => {
    const texts = [
      listingAvailabilityNotice('Sold', 'Rent')?.message,
      listingAvailabilityNotice('Sold', 'Rent')?.label,
      listingStatusNote('Sold', 'Rent'),
      listingStatusAgentLine('Sold', 'Rent'),
      unavailableListingSharePrompt('Sold', 'Rent')?.title,
      unavailableListingReply(
        'Asha',
        '3BHK in Hebbal',
        'Sold',
        null,
        false,
        'Rent'
      ),
      listingAvailabilityAnswer('Sold', 'Rent'),
    ];
    for (const text of texts) {
      expect(text).toBeTruthy();
      expect(text!.toLowerCase()).not.toContain('sold');
      expect(text!.toLowerCase()).toContain('rented');
    }
    expect(listingAvailabilityAnswer('Sold', 'Built to Suit')).toContain(
      'already been leased out'
    );
  });

  it('keeps the sale wording for a sale listing', () => {
    expect(listingAvailabilityNotice('Sold')?.label).toBe('Sold');
    expect(listingStatusNote('Sold', 'Sale')).toContain('already sold');
    expect(listingAvailabilityAnswer('Sold', 'Sale')).toContain(
      'already been sold'
    );
  });
});
