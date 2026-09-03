import { describe, expect, it } from 'vitest';
import {
  listingTypesFromCurrentTurn,
  mergedListingTypes,
  sanitizeListingTypes,
} from './preference-extraction';

describe('listingTypesFromCurrentTurn', () => {
  it('lets the buyer replace a rental enquiry with a purchase requirement', () => {
    expect(
      listingTypesFromCurrentTurn(
        'Hi, not interested in renting. Are there commercial properties for sale?'
      )
    ).toEqual(['Sale']);
  });

  it('keeps both only when the current message genuinely asks for both', () => {
    expect(
      listingTypesFromCurrentTurn('Show me properties to buy or rent')
    ).toEqual(['Sale', 'Rent']);
  });

  it('understands an explicit either-or correction', () => {
    expect(
      listingTypesFromCurrentTurn('I want to buy instead of rent')
    ).toEqual(['Sale']);
  });

  it('does not invent an intent from an unrelated requirement update', () => {
    expect(
      listingTypesFromCurrentTurn('Commercial property in Jayanagar')
    ).toBeNull();
  });
});

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
