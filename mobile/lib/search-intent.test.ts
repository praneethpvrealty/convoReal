import { describe, expect, it } from 'vitest';

import { isStructuredQuery } from './search-intent';

describe('isStructuredQuery', () => {
  it('detects operator price bounds', () => {
    expect(isStructuredQuery('Commercial properties < 9.5 cr')).toBe(true);
    expect(isStructuredQuery('>= 50 lakhs')).toBe(true);
    expect(isStructuredQuery('plots > 2cr')).toBe(true);
  });

  it('detects bare amounts with a unit', () => {
    expect(isStructuredQuery('villa 3.5 cr')).toBe(true);
    expect(isStructuredQuery('80L flats')).toBe(true);
    expect(isStructuredQuery('500k budget')).toBe(true);
  });

  it('detects bedroom counts', () => {
    expect(isStructuredQuery('2bhk')).toBe(true);
    expect(isStructuredQuery('3 bedroom apartment')).toBe(true);
    expect(isStructuredQuery('4-bed villa')).toBe(true);
  });

  it('detects area bounds', () => {
    expect(isStructuredQuery('plot above 30000 sqft')).toBe(true);
    expect(isStructuredQuery('land under 2 acres')).toBe(true);
    expect(isStructuredQuery('5 guntas')).toBe(true);
  });

  it('detects keyword bounds', () => {
    expect(isStructuredQuery('anything under 80')).toBe(true);
    expect(isStructuredQuery('between 1 and 3')).toBe(true);
  });

  it('leaves plain locality and project text alone', () => {
    expect(isStructuredQuery('Whitefield')).toBe(false);
    expect(isStructuredQuery('JP Nagar 5th phase')).toBe(false);
    expect(isStructuredQuery('Prestige Shantiniketan')).toBe(false);
    expect(isStructuredQuery('commercial building')).toBe(false);
    expect(isStructuredQuery('')).toBe(false);
  });

  it('treats a locality carrying a bound as structured', () => {
    expect(isStructuredQuery('Whitefield 3bhk under 90L')).toBe(true);
  });
});
