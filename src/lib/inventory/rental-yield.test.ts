import { describe, expect, it } from 'vitest';

import {
  isMonthlyPricedListing,
  rentalYieldPercent,
  yieldApplies,
} from '@/lib/inventory/rental-yield';

describe('rentalYieldPercent', () => {
  it('derives the yield of a sale from rent over the capital price', () => {
    expect(rentalYieldPercent('Sale', 30_000_000, 150_000)).toBe(6);
  });

  it('treats a missing listing type as a sale', () => {
    expect(rentalYieldPercent(null, 30_000_000, 150_000)).toBe(6);
  });

  // PROP-1205: a ₹15.5 L/month office stored 15.5 L in BOTH price and
  // rental_income, because a rental's price is its monthly rent — and
  // advertised "1200% yield" on the detail screen.
  it('has no yield for a rental, whose price is a month not a purchase', () => {
    expect(rentalYieldPercent('Rent', 1_548_000, 1_548_000)).toBeNull();
  });

  it('has no yield for a Built to Suit, priced per month the same way', () => {
    expect(
      rentalYieldPercent('Built to Suit', 1_548_000, 1_548_000)
    ).toBeNull();
  });

  // A joint development has no asking price to divide by; whatever sits
  // in `price` is an estimated project value, not something for sale.
  it('has no yield for a JV/JD deal', () => {
    expect(rentalYieldPercent('JV/JD', 30_000_000, 150_000)).toBeNull();
  });

  it('needs both halves of the sum', () => {
    expect(rentalYieldPercent('Sale', 30_000_000, null)).toBeNull();
    expect(rentalYieldPercent('Sale', null, 150_000)).toBeNull();
    expect(rentalYieldPercent('Sale', 0, 150_000)).toBeNull();
    expect(rentalYieldPercent('Sale', 30_000_000, 0)).toBeNull();
  });

  it('rounds to two decimals', () => {
    expect(rentalYieldPercent('Sale', 13_500_000, 62_000)).toBe(5.51);
  });
});

describe('isMonthlyPricedListing / yieldApplies', () => {
  it('names the listing types priced per month', () => {
    expect(isMonthlyPricedListing('Rent')).toBe(true);
    expect(isMonthlyPricedListing('Built to Suit')).toBe(true);
    expect(isMonthlyPricedListing('Sale')).toBe(false);
    expect(isMonthlyPricedListing('JV/JD')).toBe(false);
  });

  it('allows a yield on a sale only', () => {
    expect(yieldApplies('Sale')).toBe(true);
    expect(yieldApplies(undefined)).toBe(true);
    expect(yieldApplies('Rent')).toBe(false);
    expect(yieldApplies('JV/JD')).toBe(false);
  });
});
