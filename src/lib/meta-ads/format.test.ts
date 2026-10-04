import { describe, it, expect } from 'vitest';
import { formatAdMoney } from './format';

describe('formatAdMoney', () => {
  it('formats INR with Indian grouping and no paise on whole amounts', () => {
    expect(formatAdMoney(1500, 'INR')).toBe('₹1,500');
  });

  it('keeps two decimals when paise matter', () => {
    expect(formatAdMoney(250.5, 'INR')).toBe('₹250.50');
  });

  it('abbreviates large INR amounts', () => {
    expect(formatAdMoney(250000, 'INR')).toBe('₹2.5 L');
  });

  it('uses the ad account currency instead of the rupee sign', () => {
    expect(formatAdMoney(1500, 'USD')).toBe('$1,500');
    expect(formatAdMoney(12.345, 'USD')).toBe('$12.35');
  });

  it('falls back to the code for an unknown currency', () => {
    expect(formatAdMoney(10, 'NOPE')).toBe('NOPE 10');
  });
});
