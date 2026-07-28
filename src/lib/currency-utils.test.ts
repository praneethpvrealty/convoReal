import { describe, it, expect } from 'vitest';

import { equivalentPriceLabel } from '@/lib/currency-utils';

describe('equivalentPriceLabel', () => {
  it('reads a crore-scale amount the way an agent says it', () => {
    expect(equivalentPriceLabel('160000000')).toBe('Equivalent to: ₹16 Crore');
    expect(equivalentPriceLabel('140000000')).toBe('Equivalent to: ₹14 Crore');
    expect(equivalentPriceLabel(12500000)).toBe('Equivalent to: ₹1.25 Crore');
  });

  it('drops trailing zeros rather than showing ₹1.20 Crore', () => {
    expect(equivalentPriceLabel(12000000)).toBe('Equivalent to: ₹1.2 Crore');
    expect(equivalentPriceLabel(10000000)).toBe('Equivalent to: ₹1 Crore');
  });

  it('switches to lakhs below a crore', () => {
    expect(equivalentPriceLabel(8500000)).toBe('Equivalent to: ₹85 Lakhs');
    expect(equivalentPriceLabel(100000)).toBe('Equivalent to: ₹1 Lakhs');
  });

  it('groups smaller amounts Indian-style — rents and maintenance live here', () => {
    expect(equivalentPriceLabel(45000)).toBe('Equivalent to: ₹45,000');
    expect(equivalentPriceLabel(250000 / 100)).toBe('Equivalent to: ₹2,500');
  });

  it('returns nothing for input that is not a positive amount', () => {
    for (const v of ['', null, undefined, '0', 0, -1, 'abc', NaN, Infinity]) {
      expect(equivalentPriceLabel(v as string | number | null | undefined)).toBe('');
    }
  });

  it('uses the symbol and plain grouping for non-INR currencies', () => {
    expect(equivalentPriceLabel(1500000, 'USD')).toBe('Equivalent to: $1,500,000');
    expect(equivalentPriceLabel(2000, 'GBP')).toBe('Equivalent to: £2,000');
  });

  it('falls back to no symbol for a currency it does not know', () => {
    expect(equivalentPriceLabel(1000, 'XYZ')).toBe('Equivalent to: 1,000');
  });
});
