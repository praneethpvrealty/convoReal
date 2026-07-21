import { describe, expect, it } from 'vitest';

import { parseNumeric } from './parse-numeric';

describe('parseNumeric — numbers and nullish', () => {
  it('passes finite numbers through', () => {
    expect(parseNumeric(42)).toBe(42);
    expect(parseNumeric(0)).toBe(0);
    expect(parseNumeric(3.5)).toBe(3.5);
  });

  it('maps NaN and nullish to null', () => {
    expect(parseNumeric(NaN)).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });

  it('returns null for non-string, non-number types', () => {
    expect(parseNumeric(true)).toBeNull();
    expect(parseNumeric({})).toBeNull();
    expect(parseNumeric([])).toBeNull();
  });
});

describe('parseNumeric — string cleaning', () => {
  it('strips currency symbols and units around a clean value', () => {
    expect(parseNumeric('₹2500')).toBe(2500);
    expect(parseNumeric('3500.50 sqft')).toBe(3500.5);
    expect(parseNumeric('  1200  ')).toBe(1200);
  });

  it('strips thousands separators, including Indian grouping', () => {
    expect(parseNumeric('2,500')).toBe(2500);
    expect(parseNumeric('1,00,000')).toBe(100000);
  });

  it('returns null when a string has no digits', () => {
    expect(parseNumeric('abc')).toBeNull();
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('₹')).toBeNull();
  });
});

describe('parseNumeric — CHARACTERIZATION of lossy paths', () => {
  // Documents known lossiness so a future change is a conscious one.
  it('does NOT interpret magnitude words — "1.5 Cr" becomes 1.5, not 15000000', () => {
    expect(parseNumeric('1.5 Cr')).toBe(1.5);
  });

  it('truncates at the second dot — "1.5.0" becomes 1.5 (parseFloat stops)', () => {
    expect(parseNumeric('1.5.0')).toBe(1.5);
  });
});
