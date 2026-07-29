import { describe, expect, it } from 'vitest';
import {
  catalogCategories,
  catalogLocalities,
  matchProperties,
  parseBudgetText,
} from './catalog-match';
import type { Property } from '@/types';

function property(overrides: Partial<Property>): Property {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'acc',
    user_id: null,
    title: 'Listing',
    price: 10_000_000,
    location: 'Bangalore',
    type: 'Flat/Apartment',
    status: 'Available',
    listing_type: 'Sale',
    ...overrides,
  } as Property;
}

describe('parseBudgetText', () => {
  it('reads the chip labels', () => {
    expect(parseBudgetText('Under ₹50L')).toEqual({
      min: null,
      max: 5_000_000,
    });
    expect(parseBudgetText('₹50L – ₹1Cr')).toEqual({
      min: 5_000_000,
      max: 10_000_000,
    });
    expect(parseBudgetText('₹5Cr+')).toEqual({ min: 50_000_000, max: null });
    expect(parseBudgetText('Flexible')).toEqual({ min: null, max: null });
  });

  it('inherits the unit across a bare range', () => {
    expect(parseBudgetText('₹1 – 2Cr')).toEqual({
      min: 10_000_000,
      max: 20_000_000,
    });
    expect(parseBudgetText('2-3 crore')).toEqual({
      min: 20_000_000,
      max: 30_000_000,
    });
  });

  it('reads what a buyer types', () => {
    expect(parseBudgetText('around 1.5 cr')).toEqual({
      min: null,
      max: 16_500_000,
    });
    expect(parseBudgetText('below 80 lakhs')).toEqual({
      min: null,
      max: 8_000_000,
    });
    expect(parseBudgetText('at least 2 cr')).toEqual({
      min: 20_000_000,
      max: null,
    });
  });

  it('reads monthly rents', () => {
    expect(parseBudgetText('Under ₹25k')).toEqual({ min: null, max: 25_000 });
    expect(parseBudgetText('₹25k – ₹50k')).toEqual({
      min: 25_000,
      max: 50_000,
    });
  });

  it('returns an open range for unparseable text', () => {
    expect(parseBudgetText('')).toEqual({ min: null, max: null });
    expect(parseBudgetText('no idea yet')).toEqual({ min: null, max: null });
  });
});

describe('matchProperties', () => {
  const catalog = [
    property({
      id: 'a',
      type: 'Villa',
      sublocality: 'Whitefield',
      price: 18_000_000,
    }),
    property({
      id: 'b',
      type: 'Flat/Apartment',
      sublocality: 'Whitefield',
      price: 9_000_000,
      bedrooms: 3,
    }),
    property({
      id: 'c',
      type: 'Flat/Apartment',
      sublocality: 'Indiranagar',
      price: 40_000_000,
    }),
    property({
      id: 'd',
      type: 'Flat/Apartment',
      sublocality: 'Whitefield',
      rent_per_month: 45_000,
      listing_type: 'Rent',
    }),
  ];

  it('honours category, locality and budget together', () => {
    const { matches, relaxed } = matchProperties(catalog, {
      intent: 'Buying',
      category: 'Flat/Apartment',
      localities: ['Whitefield'],
      budget: { min: null, max: 10_000_000 },
    });
    expect(matches.map((m) => m.id)).toEqual(['b']);
    expect(relaxed).toBe(false);
  });

  it('keeps rentals out of a purchase search and vice versa', () => {
    const buying = matchProperties(catalog, { intent: 'Buying' }, 10);
    expect(buying.matches.map((m) => m.id)).not.toContain('d');

    const renting = matchProperties(catalog, { intent: 'Renting' }, 10);
    expect(renting.matches.map((m) => m.id)).toEqual(['d']);
  });

  it('excludes a stated bedroom count that the listing contradicts', () => {
    const withTwoBed = [
      ...catalog,
      property({
        id: 'e',
        type: 'Flat/Apartment',
        sublocality: 'Whitefield',
        bedrooms: 2,
        price: 7_000_000,
      }),
    ];
    const { matches } = matchProperties(
      withTwoBed,
      { intent: 'Buying', category: '3 BHK apartment' },
      10
    );
    const ids = matches.map((m) => m.id);
    expect(ids).not.toContain('e');
    // A listing with no bedroom count on file stays in — missing data
    // shouldn't hide inventory — but the exact match ranks above it.
    expect(ids[0]).toBe('b');
    expect(ids).toContain('c');
  });

  it('relaxes locality before budget rather than dead-ending', () => {
    const { matches, relaxed } = matchProperties(catalog, {
      intent: 'Buying',
      category: 'Flat/Apartment',
      localities: ['Koramangala'],
      budget: { min: null, max: 10_000_000 },
    });
    expect(relaxed).toBe(true);
    expect(matches.map((m) => m.id)).toEqual(['b']);
  });

  it('reports an empty catalog honestly', () => {
    const { matches, scopeCount } = matchProperties([], { intent: 'Buying' });
    expect(matches).toEqual([]);
    expect(scopeCount).toBe(0);
  });

  it('caps the number of matches shown', () => {
    const { matches } = matchProperties(catalog, { intent: 'Buying' }, 2);
    expect(matches).toHaveLength(2);
  });
});

describe('chip sources', () => {
  it('lists the most-stocked types and areas first', () => {
    const catalog = [
      property({ type: 'Villa', sublocality: 'Whitefield' }),
      property({ type: 'Flat/Apartment', sublocality: 'Whitefield' }),
      property({ type: 'Flat/Apartment', sublocality: 'Indiranagar' }),
      property({ type: 'Flat/Apartment', sublocality: '', location: 'Hebbal' }),
    ];
    expect(catalogCategories(catalog)).toEqual(['Flat/Apartment', 'Villa']);
    expect(catalogLocalities(catalog)).toEqual([
      'Whitefield',
      'Hebbal',
      'Indiranagar',
    ]);
  });
});
