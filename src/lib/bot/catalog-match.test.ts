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

  it('does not match a category on a generic qualifier alone', () => {
    // Reported from a live showcase: a visitor asking to rent a
    // "Residential House" was shown a "Residential PG building" as a
    // fit, because the two share the word "residential".
    const pg = property({
      id: 'pg',
      type: 'Residential PG building',
      title: 'High rent yielding PG building on 2400 sqft plot',
      sublocality: 'Ekath',
      listing_type: 'Rent',
      rent_per_month: 620_000,
    });
    const house = property({
      id: 'house',
      type: 'Independent House',
      title: 'North facing independent house',
      sublocality: 'Ekath',
      listing_type: 'Rent',
      rent_per_month: 120_000,
    });

    const { matches } = matchProperties(
      [pg, house],
      { intent: 'Renting', category: 'Residential House' },
      10
    );
    // Only the house passes the category filter; the PG survives solely
    // because the engine relaxes rather than dead-ending.
    expect(matches[0].id).toBe('house');

    const pgOnly = matchProperties(
      [pg],
      { intent: 'Renting', category: 'Residential House' },
      10
    );
    expect(pgOnly.relaxed).toBe(true);
  });

  it('still matches the catalog chip for its own type', () => {
    const pg = property({
      id: 'pg',
      type: 'Residential PG building',
      listing_type: 'Rent',
      rent_per_month: 620_000,
    });
    const { matches, relaxed } = matchProperties(
      [pg],
      { intent: 'Renting', category: 'Residential PG building' },
      10
    );
    expect(matches.map((m) => m.id)).toEqual(['pg']);
    expect(relaxed).toBe(false);
  });

  it('lets an all-generic category match on the qualifier', () => {
    const shop = property({ id: 'shop', type: 'Commercial', price: 5_000_000 });
    const villa = property({ id: 'villa', type: 'Villa', price: 5_000_000 });
    const { matches, relaxed } = matchProperties(
      [shop, villa],
      { intent: 'Buying', category: 'Commercial' },
      10
    );
    expect(matches.map((m) => m.id)).toEqual(['shop']);
    expect(relaxed).toBe(false);
  });

  it('tolerates a plural the catalog spells singular', () => {
    const villa = property({ id: 'villa', type: 'Villa', price: 5_000_000 });
    const flat = property({ id: 'flat', type: 'Flat/Apartment', price: 5_000_000 });
    const { matches, relaxed } = matchProperties(
      [villa, flat],
      { intent: 'Buying', category: 'Villas' },
      10
    );
    expect(matches.map((m) => m.id)).toEqual(['villa']);
    expect(relaxed).toBe(false);
  });

  it('does not treat a listing with no type as matching every category', () => {
    const untyped = property({
      id: 'untyped',
      type: '',
      title: 'Plot on Hosa Road',
      price: 5_000_000,
    });
    const { matches, relaxed } = matchProperties(
      [untyped],
      { intent: 'Buying', category: 'Villa' },
      10
    );
    // It can still be shown, but only as a relaxed result — never as a
    // category fit.
    expect(relaxed).toBe(true);
    expect(matches.map((m) => m.id)).toEqual(['untyped']);
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

describe('parseBudgetText with a rent/sale context', () => {
  it('reads a bare rental range as thousands a month', () => {
    // Nasrin typed exactly this. Without context it parsed as Rs 35-45.
    expect(parseBudgetText('35 to 45', 'rent')).toEqual({ min: 35_000, max: 45_000 });
    expect(parseBudgetText('Budget 35 to 40', 'rent')).toEqual({ min: 35_000, max: 40_000 });
  });

  it('leaves a rent figure already written in rupees alone', () => {
    expect(parseBudgetText('18000', 'rent').max).toBeCloseTo(18_000 * 1.1, 0);
    expect(parseBudgetText('25000 to 40000', 'rent')).toEqual({ min: 25_000, max: 40_000 });
  });

  it('reads a small bare sale range as crores', () => {
    expect(parseBudgetText('1-2', 'sale')).toEqual({ min: 10_000_000, max: 20_000_000 });
    expect(parseBudgetText('2 to 5', 'sale')).toEqual({ min: 20_000_000, max: 50_000_000 });
  });

  it('reads a larger bare sale figure as lakh, because nobody means 80 crore', () => {
    expect(parseBudgetText('50 to 80', 'sale')).toEqual({ min: 5_000_000, max: 8_000_000 });
  });

  it('never lets the context override a unit the visitor typed', () => {
    expect(parseBudgetText('35k to 45k', 'rent')).toEqual({ min: 35_000, max: 45_000 });
    expect(parseBudgetText('1.5 cr', 'sale').max).toBeCloseTo(15_000_000 * 1.1, 0);
    expect(parseBudgetText('50L to 1Cr', 'sale')).toEqual({ min: 5_000_000, max: 10_000_000 });
  });

  it('keeps the literal reading when no context is supplied', () => {
    expect(parseBudgetText('35 to 45')).toEqual({ min: 35, max: 45 });
  });
});
