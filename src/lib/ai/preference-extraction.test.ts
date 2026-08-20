import { describe, expect, it } from 'vitest';
import {
  mergedListingTypes,
  sanitizeListingTypes,
} from './preference-extraction';

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

describe('sanitizeListingTypes', () => {
  // The contact API takes this straight from a client payload, so the
  // vocabulary check is the boundary: an unrecognised value stored here
  // reads as an intent no listing can satisfy, hiding the whole
  // inventory from the contact.
  it('keeps the values the matcher understands', () => {
    expect(sanitizeListingTypes(['Sale', 'Rent'])).toEqual(['Sale', 'Rent']);
    expect(sanitizeListingTypes(['JV/JD'])).toEqual(['JV/JD']);
  });

  it('drops anything outside the vocabulary', () => {
    expect(sanitizeListingTypes(['Renting', 'Sale', 42, null])).toEqual([
      'Sale',
    ]);
  });

  it('treats a missing or non-array value as unstated', () => {
    expect(sanitizeListingTypes(undefined)).toEqual([]);
    expect(sanitizeListingTypes('Sale')).toEqual([]);
    expect(sanitizeListingTypes(null)).toEqual([]);
  });
});
