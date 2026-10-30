import { describe, expect, it } from 'vitest';
import {
  bhkRangeFromRequirement,
  budgetFromPerSqftRequirement,
  floorBarePlotSize,
  listingTypesFromCurrentTurn,
  mergedListingTypes,
  preferenceSourceHash,
  sanitizeListingTypes,
} from './preference-extraction';

describe('bhkRangeFromRequirement', () => {
  it('extracts an either-or BHK requirement', () => {
    expect(
      bhkRangeFromRequirement('Looking for a 2 bhk or a 3bhk in Malleshwaram')
    ).toEqual({ min: 2, max: 3 });
  });

  it('extracts a compact BHK range', () => {
    expect(bhkRangeFromRequirement('Need a 2-3 BHK')).toEqual({
      min: 2,
      max: 3,
    });
  });
});

describe('budgetFromPerSqftRequirement', () => {
  it('derives a total budget band from the rate and area ranges', () => {
    expect(
      budgetFromPerSqftRequirement(
        '3000sqft to 4000sqft within price range of 40k to 45k per sqft',
        3000,
        4000
      )
    ).toEqual({ recognized: true, min: 120_000_000, max: 180_000_000 });
  });

  it('supports formatted rupee rates and slash notation', () => {
    expect(
      budgetFromPerSqftRequirement(
        'Need 2,000 to 2,500 sqft at ₹40,000–₹45,000/sq.ft',
        2000,
        2500
      )
    ).toEqual({ recognized: true, min: 80_000_000, max: 112_500_000 });
  });

  it('does not store a per-sqft rate as a total when area is unavailable', () => {
    expect(
      budgetFromPerSqftRequirement('Budget is 40k to 45k psf', null, null)
    ).toEqual({ recognized: true, min: null, max: null });
  });

  it('leaves ordinary total budgets unchanged', () => {
    expect(
      budgetFromPerSqftRequirement('Budget is ₹12 Cr to ₹18 Cr', 3000, 4000)
    ).toEqual({ recognized: false, min: null, max: null });
  });
});

describe('preferenceSourceHash', () => {
  it('invalidates earlier extraction results after the plot-size floor', () => {
    expect(preferenceSourceHash('same requirement')).toMatch(/^v5:/);
  });
});

describe('floorBarePlotSize', () => {
  const plot = (
    min: number | null,
    max: number | null,
    types = ['Residential Plot']
  ) => ({
    property_types: types,
    property_categories: [] as string[],
    land_area_min_sqft: min,
    land_area_max_sqft: max,
  });

  it('[CTM-016] reads a bare plot size as the floor', () => {
    expect(
      floorBarePlotSize('Residential plot 4000 sqft in HSR', plot(4000, 4000))
    ).toMatchObject({ land_area_min_sqft: 4000, land_area_max_sqft: null });
    expect(
      floorBarePlotSize('1 acre land near Sarjapur', plot(43_560, 43_560, []))
    ).toMatchObject({ land_area_min_sqft: 43_560, land_area_max_sqft: null });
    expect(
      floorBarePlotSize('site of 2,400 sq. ft.', {
        ...plot(2400, 2400, []),
        property_categories: ['plot'],
      })
    ).toMatchObject({ land_area_max_sqft: null });
  });

  it('[CTM-016] keeps site dimensions and a pinned size as a point', () => {
    expect(
      floorBarePlotSize('30x40 site in JP Nagar', plot(1200, 1200))
    ).toMatchObject({ land_area_max_sqft: 1200 });
    expect(floorBarePlotSize('50 by 80 plot', plot(4000, 4000))).toMatchObject({
      land_area_max_sqft: 4000,
    });
    expect(
      floorBarePlotSize('exactly 4000 sqft plot', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
    expect(
      floorBarePlotSize('4000 sqft plot only', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
    expect(
      floorBarePlotSize('plot up to 4000 sqft, budget 2 Cr', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
  });

  it('[CTM-016] reads "around" and "4k" on a plot as a floor too', () => {
    expect(
      floorBarePlotSize('plot around 4000 sqft', plot(4000, 4000))
    ).toMatchObject({ land_area_min_sqft: 4000, land_area_max_sqft: null });
    expect(
      floorBarePlotSize('around 4k sqft site in HSR', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: null });
    expect(
      floorBarePlotSize('approx 4k sq ft plot only', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
  });

  it('[CTM-016] ignores a qualifier that belongs to the budget', () => {
    expect(
      floorBarePlotSize('Budget up to 2 Cr. 4000 sqft plot.', plot(4000, 4000))
    ).toMatchObject({ land_area_min_sqft: 4000, land_area_max_sqft: null });
    expect(
      floorBarePlotSize('Budget upto 2 Cr. 4000 sqft plot.', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: null });
    expect(
      floorBarePlotSize('4000 sqft plot, budget around 2 Cr', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: null });
  });

  it('[CTM-016] reads a qualifier only when it sits beside the figure', () => {
    expect(
      floorBarePlotSize(
        '4000 sqft plot within 5 km of airport',
        plot(4000, 4000)
      )
    ).toMatchObject({ land_area_max_sqft: null });
    expect(
      floorBarePlotSize('budget under 2cr 4000 sqft plot', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: null });
    expect(
      floorBarePlotSize('4000 sqft plot max 2 Cr', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: null });
    expect(
      floorBarePlotSize('under 4000 sqft plot', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
    expect(
      floorBarePlotSize('plot 4000 sqft max', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
    expect(
      floorBarePlotSize('not more than 4000 sqft plot', plot(4000, 4000))
    ).toMatchObject({ land_area_max_sqft: 4000 });
  });

  it('[CTM-016] leaves built-up sizes and stated bands alone', () => {
    expect(
      floorBarePlotSize('1200 sqft flat', plot(1200, 1200, ['Flat/ Apartment']))
    ).toMatchObject({ land_area_max_sqft: 1200 });
    expect(
      floorBarePlotSize('2000 to 2400 sqft plot', plot(2000, 2400))
    ).toMatchObject({ land_area_max_sqft: 2400 });
    expect(
      floorBarePlotSize('minimum 4000 sqft plot', plot(4000, null))
    ).toMatchObject({ land_area_min_sqft: 4000, land_area_max_sqft: null });
  });
});

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
