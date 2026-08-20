import { describe, expect, it } from 'vitest';
import { mergedListingTypes } from './preference-extraction';

describe('mergedListingTypes', () => {
  it('keeps a stated intent the extraction has nothing to say about', () => {
    expect(mergedListingTypes([], ['Rent'])).toEqual(['Rent']);
  });

  it('lets the text correct a stated intent', () => {
    expect(mergedListingTypes(['Sale'], ['Rent'])).toEqual(['Sale']);
  });

  it('stays empty when nobody has answered', () => {
    expect(mergedListingTypes([], null)).toEqual([]);
    expect(mergedListingTypes([], undefined)).toEqual([]);
    expect(mergedListingTypes([], [])).toEqual([]);
  });

  it('copies rather than aliasing either input', () => {
    const stored = ['Rent'];
    const out = mergedListingTypes([], stored);
    out.push('Sale');
    expect(stored).toEqual(['Rent']);
  });
});
