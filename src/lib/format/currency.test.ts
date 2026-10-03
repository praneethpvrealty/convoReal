import { describe, expect, it } from 'vitest';

import {
  formatCurrency,
  formatCurrencyShort,
  formatInrCompact,
  formatInrPlain,
  priceInWords,
} from './currency';

describe('formatInrCompact', () => {
  it.each([
    [12_500_000, '₹1.25 Cr'],
    [12_000_000, '₹1.2 Cr'],
    [10_000_000, '₹1 Cr'],
    [150_000_000, '₹15 Cr'],
    [1_550_000, '₹15.5 L'],
    [150_000, '₹1.5 L'],
    [100_000, '₹1 L'],
    [95_000, '₹95,000'],
    [1234.6, '₹1,235'],
    [0, '₹0'],
    [-4_500_000, '-₹45 L'],
  ])('%d → %s', (amount, label) => {
    expect(formatInrCompact(amount)).toBe(label);
  });
});

describe('formatInrPlain', () => {
  it('groups in the Indian style and rounds to whole rupees', () => {
    expect(formatInrPlain(1234567.4)).toBe('₹12,34,567');
    expect(formatInrPlain(950)).toBe('₹950');
  });

  it('keeps paise only when asked', () => {
    expect(formatInrPlain(123.45, 2)).toBe('₹123.45');
    expect(formatInrPlain(123.4, 2)).toBe('₹123.4');
    expect(formatInrPlain(120, 2)).toBe('₹120');
    expect(formatInrPlain(1234567.456, 2)).toBe('₹12,34,567.46');
  });
});

describe('formatCurrency', () => {
  it('keeps two decimals on listing prices unless both are zero', () => {
    expect(formatCurrency(17_000_000)).toBe('₹1.70 Cr');
    expect(formatCurrency(12_500_000)).toBe('₹1.25 Cr');
    expect(formatCurrency(20_000_000)).toBe('₹2 Cr');
    expect(formatCurrency(250_000)).toBe('₹2.50 Lakhs');
    expect(formatCurrency(8_500_000)).toBe('₹85 Lakhs');
    expect(formatCurrency(85_000)).toBe('₹85,000');
  });

  it('renders other currencies through Intl', () => {
    expect(formatCurrency(1_250_000, 'USD')).toBe('$1,250,000');
  });
});

describe('priceInWords', () => {
  it('says the amount the way an agent would', () => {
    expect(priceInWords(160_000_000)).toBe('₹16 Crore');
    expect(priceInWords(12_000_000)).toBe('₹1.2 Crore');
    expect(priceInWords(8_500_000)).toBe('₹85 Lakhs');
    expect(priceInWords(45_000)).toBe('₹45,000');
    expect(priceInWords('')).toBe('');
    expect(priceInWords(-5)).toBe('');
  });
});

describe('formatCurrencyShort', () => {
  it('uses one decimal for dashboard tiles', () => {
    expect(formatCurrencyShort(12_500_000)).toBe('₹1.3 Cr');
    expect(formatCurrencyShort(4_500_000)).toBe('₹45 L');
    expect(formatCurrencyShort(2_500_000, 'USD')).toBe('$2.5M');
  });
});
