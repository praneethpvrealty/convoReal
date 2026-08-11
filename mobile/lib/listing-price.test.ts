import { describe, expect, it } from 'vitest';

import { listingPrice } from './listing-price';
import type { Property } from './types';

const base = {
  id: 'p1',
  title: 'A listing',
  type: 'Residential Land',
  listing_type: 'Sale',
  price: 0,
  location: 'Hoskote Road',
} as unknown as Property;

const make = (patch: Partial<Property>): Property =>
  ({ ...base, ...patch }) as Property;

describe('listingPrice', () => {
  it('prices a sale', () => {
    expect(listingPrice(make({ price: 150000000 }))).toEqual({
      label: 'PRICE',
      value: '₹15 Cr',
      note: 'Equivalent to: ₹15 Crore',
    });
  });

  it('prices a rental per month', () => {
    expect(
      listingPrice(make({ listing_type: 'Rent', rent_per_month: 85000 }))
    ).toEqual({
      label: 'RENT',
      value: '₹85,000/month',
      note: 'Equivalent to: ₹85,000',
    });
  });

  it('prices Built to Suit per month too, like the web', () => {
    expect(
      listingPrice(
        make({ listing_type: 'Built to Suit', rent_per_month: 250000 })
      ).value
    ).toBe('₹2.5 L/month');
  });

  // A joint development has no asking price — printing "—" under a
  // PRICE caption read as a listing with its price left blank.
  it('shows the deal, not a price, for JV/JD', () => {
    expect(listingPrice(make({ listing_type: 'JV/JD' }))).toEqual({
      label: 'DEAL',
      value: 'JV / JD',
      note: null,
    });
  });

  it('shows the share split when both sides are agreed', () => {
    expect(
      listingPrice(
        make({
          listing_type: 'JV/JD',
          owner_share_percent: 60,
          builder_share_percent: 40,
        })
      ).value
    ).toBe('60:40 share');
  });

  it('carries an estimated value as a note, never as the price', () => {
    const p = listingPrice(make({ listing_type: 'JV/JD', price: 120000000 }));
    expect(p.value).toBe('JV / JD');
    expect(p.note).toBe('Est. ₹12 Cr');
  });
});
