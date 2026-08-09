import { describe, it, expect } from 'vitest';
import {
  applyListingDerivations,
  detectJointDevelopment,
  extractDimensionsFromText,
  extractRateQuote,
  parseDimensionsToSqft,
  toSquareFeet,
} from '@/lib/ai/listing-derivations';
import type { ParsedPropertyDraft } from '@/lib/ai/gemini';

function makeDraft(overrides: Partial<ParsedPropertyDraft> = {}): ParsedPropertyDraft {
  return {
    title: null,
    price: null,
    location: null,
    type: null,
    sublocality: null,
    city: null,
    state: null,
    bedrooms: null,
    bathrooms: null,
    area_sqft: null,
    land_area: null,
    land_area_unit: null,
    description: null,
    features: null,
    nearby_highlights: null,
    dimensions: null,
    facing_direction: null,
    rental_income: null,
    roi: null,
    google_map_link: null,
    images: [],
    owner_contact_name: null,
    owner_contact_phone: null,
    owner_contact_role: null,
    listing_type: null,
    rent_per_month: null,
    maintenance: null,
    advance: null,
    gst: null,
    ...overrides,
  };
}

describe('parseDimensionsToSqft', () => {
  it('multiplies the two sides', () => {
    expect(parseDimensionsToSqft('60*40')).toBe(2400);
    expect(parseDimensionsToSqft('30x40')).toBe(1200);
    expect(parseDimensionsToSqft('50 × 80')).toBe(4000);
    expect(parseDimensionsToSqft('60ft x 40ft')).toBe(2400);
  });

  it('rejects irregular plots with a third factor', () => {
    expect(parseDimensionsToSqft('30x40x50')).toBeNull();
  });

  it('rejects nonsense and out-of-range values', () => {
    expect(parseDimensionsToSqft(null)).toBeNull();
    expect(parseDimensionsToSqft('2400 sqft')).toBeNull();
    expect(parseDimensionsToSqft('2x3')).toBeNull();
  });
});

describe('extractDimensionsFromText', () => {
  it('picks up a size given in a plain message', () => {
    expect(extractDimensionsFromText('Size - 60*40')).toBe('60x40');
    expect(extractDimensionsFromText('plot is 30 x 40 feet')).toBe('30x40');
  });

  it('ignores text without a dimension', () => {
    expect(extractDimensionsFromText('Land area - 2400 sqft')).toBeNull();
  });
});

describe('extractRateQuote', () => {
  it('reads a per-sqft rate', () => {
    expect(extractRateQuote('Price - 10500 per sqft.')).toEqual({ perSqft: 10500, amount: 10500 });
    expect(extractRateQuote('₹4,500/sq.ft.')).toEqual({ perSqft: 4500, amount: 4500 });
    expect(extractRateQuote('10500 psf')).toEqual({ perSqft: 10500, amount: 10500 });
  });

  it('normalizes other units to per-sqft', () => {
    const quote = extractRateQuote('1.2 Cr per acre');
    expect(quote?.amount).toBe(12000000);
    expect(quote?.perSqft).toBeCloseTo(275.48, 2);
  });

  it('ignores rental rates and plain areas', () => {
    expect(extractRateQuote('₹85 per sqft per month')).toBeNull();
    expect(extractRateQuote('Land area - 2400 sqft')).toBeNull();
    expect(extractRateQuote('Price - 2.5 Cr')).toBeNull();
  });
});

describe('toSquareFeet', () => {
  it('converts the land-area units', () => {
    expect(toSquareFeet(2400, 'Sq.Ft.')).toBe(2400);
    expect(toSquareFeet(2, 'Acre')).toBe(87120);
    expect(toSquareFeet(2, 'Acres')).toBe(87120);
    expect(toSquareFeet(1, 'Ground')).toBe(2400);
    expect(toSquareFeet(null, 'Acre')).toBeNull();
  });
});

describe('applyListingDerivations', () => {
  it('maps a dimension onto the land area', () => {
    const derived = applyListingDerivations(makeDraft(), 'Size - 60*40');
    expect(derived.dimensions).toBe('60x40');
    expect(derived.land_area).toBe(2400);
    expect(derived.land_area_unit).toBe('Sq.Ft.');
  });

  it('leaves an explicitly stated land area alone', () => {
    const derived = applyListingDerivations(
      makeDraft({ land_area: 2000, land_area_unit: 'Sq.Ft.' }),
      'Size - 60*40'
    );
    expect(derived.land_area).toBe(2000);
  });

  it('remembers a rate quoted before the area is known', () => {
    const derived = applyListingDerivations(makeDraft(), 'Price - 10500 per sqft.');
    expect(derived.price_per_sqft).toBe(10500);
    expect(derived.price).toBeNull();
  });

  it('calculates the price once the area arrives in a later message', () => {
    const withRate = applyListingDerivations(makeDraft({ type: 'Residential Land/ Plot' }), 'Price - 10500 per sqft.');
    const withArea = applyListingDerivations(
      { ...withRate, land_area: 2400, land_area_unit: 'Sq.Ft.' },
      'Land area - 2400 sqft',
      withRate
    );
    expect(withArea.price).toBe(25200000);
    expect(withArea.price_from_rate).toBe(true);
  });

  it('calculates the price from a dimension given after the rate', () => {
    const withRate = applyListingDerivations(makeDraft({ type: 'Residential Land/ Plot' }), 'Price - 10500 per sqft.');
    const withSize = applyListingDerivations({ ...withRate }, 'Size - 60*40', withRate);
    expect(withSize.land_area).toBe(2400);
    expect(withSize.price).toBe(25200000);
  });

  it('treats a rate the model filed as the total price as a rate', () => {
    const derived = applyListingDerivations(
      makeDraft({ price: 10500, land_area: 2400, land_area_unit: 'Sq.Ft.', type: 'Residential Land/ Plot' }),
      'Price - 10500 per sqft.'
    );
    expect(derived.price_per_sqft).toBe(10500);
    expect(derived.price).toBe(25200000);
  });

  it('re-derives the price when the area is corrected', () => {
    const first = applyListingDerivations(
      makeDraft({ type: 'Residential Land/ Plot', land_area: 2400, land_area_unit: 'Sq.Ft.' }),
      'Price - 10500 per sqft.'
    );
    expect(first.price).toBe(25200000);
    const corrected = applyListingDerivations({ ...first, land_area: 1200 }, 'Land area is 1200 sqft', first);
    expect(corrected.price).toBe(12600000);
  });

  it('never overwrites a total price the user states outright', () => {
    const first = applyListingDerivations(
      makeDraft({ type: 'Residential Land/ Plot', land_area: 2400, land_area_unit: 'Sq.Ft.' }),
      'Price - 10500 per sqft.'
    );
    const explicit = applyListingDerivations({ ...first, price: 20000000 }, 'Price is 2 Cr', first);
    expect(explicit.price).toBe(20000000);
    expect(explicit.price_from_rate).toBe(false);

    const later = applyListingDerivations({ ...explicit, land_area: 3000 }, 'Land area 3000 sqft', explicit);
    expect(later.price).toBe(20000000);
  });

  it('prices a built structure off its built-up area', () => {
    const derived = applyListingDerivations(
      makeDraft({ type: 'Flat/ Apartment', area_sqft: 1450, land_area: 2400, land_area_unit: 'Sq.Ft.' }),
      '8000 per sqft'
    );
    expect(derived.price).toBe(11600000);
  });

  it('leaves rental listings out of the price maths', () => {
    const derived = applyListingDerivations(
      makeDraft({ listing_type: 'Rent', area_sqft: 1000 }),
      'Rate is 85 per sqft'
    );
    expect(derived.price).toBeNull();
  });
});

describe('detectJointDevelopment', () => {
  it('reads the abbreviations and the spelled-out phrases', () => {
    expect(detectJointDevelopment('12 acres available for an apartment JD behind Brigade')).toBe(true);
    expect(detectJointDevelopment('Open for JV on revenue share basis')).toBe(true);
    expect(detectJointDevelopment('Land offered for joint development')).toBe(true);
    expect(detectJointDevelopment('Joint Venture with a reputed builder')).toBe(true);
  });

  it('ignores a name that merely starts with the same letters', () => {
    expect(detectJointDevelopment('3 BHK in JD Tower, Whitefield')).toBe(false);
    expect(detectJointDevelopment('Contact Mr Jd for details')).toBe(false);
    expect(detectJointDevelopment(null)).toBe(false);
  });
});

describe('applyListingDerivations — joint development', () => {
  it('reads a JD offer the model filed as a sale', () => {
    const derived = applyListingDerivations(
      makeDraft({ type: 'Residential Land/ Plot', listing_type: 'Sale' }),
      '12 acres residential converted land available for an apartment JD, Hoskote Road'
    );
    expect(derived.listing_type).toBe('JV/JD');
  });

  it('completes the share split from whichever side was quoted', () => {
    const derived = applyListingDerivations(
      makeDraft({ listing_type: 'JV/JD', owner_share_percent: 40 })
    );
    expect(derived.owner_share_percent).toBe(40);
    expect(derived.builder_share_percent).toBe(60);
  });

  it('normalizes the structure the model reported', () => {
    const derived = applyListingDerivations(
      makeDraft({ listing_type: 'JV/JD', jv_structure: 'area sharing' as never })
    );
    expect(derived.jv_structure).toBe('Area Share');
  });

  it('never turns a per-acre deal rate into a project value', () => {
    const previous = makeDraft({
      listing_type: 'JV/JD',
      type: 'Residential Land/ Plot',
      land_area: 12,
      land_area_unit: 'Acre',
    });
    const derived = applyListingDerivations(
      { ...previous, goodwill_amount: 300000000 },
      "it's a JD, area share 60:40, Good will and Advance 2.5 cr per acre.",
      previous
    );
    expect(derived.price).toBeNull();
    expect(derived.price_per_sqft).toBeNull();
    expect(derived.goodwill_amount).toBe(300000000);
  });

  it('withdraws a project value it derived on an earlier pass', () => {
    const derived = applyListingDerivations(
      makeDraft({
        listing_type: 'JV/JD',
        land_area: 12,
        land_area_unit: 'Acre',
        price: 300000000,
        price_from_rate: true,
        price_per_sqft: 5739.6,
      })
    );
    expect(derived.price).toBeNull();
    expect(derived.price_from_rate).toBe(false);
  });

  it('keeps a project value the lister stated outright', () => {
    const derived = applyListingDerivations(
      makeDraft({ listing_type: 'JV/JD', price: 5000000000, price_from_rate: false }),
      'Expected project value is 500 Cr'
    );
    expect(derived.price).toBe(5000000000);
  });

  it('still prices a plain land sale off its per-acre rate', () => {
    const derived = applyListingDerivations(
      makeDraft({ type: 'Agricultural Land', land_area: 2, land_area_unit: 'Acre' }),
      'Selling at 1.2 Cr per acre'
    );
    expect(derived.price).toBe(24000000);
  });

  it('lets a correction move the listing back to a sale', () => {
    const previous = makeDraft({
      title: '12 acres available for an apartment JD',
      listing_type: 'JV/JD',
    });
    const derived = applyListingDerivations(
      { ...previous, listing_type: 'Sale', price: 120000000 },
      'Actually it is an outright sale at 12 Cr',
      previous
    );
    expect(derived.listing_type).toBe('Sale');
  });
});
