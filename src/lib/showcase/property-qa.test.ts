import { describe, it, expect } from 'vitest';
import {
  answerFromPropertyData,
  asksToIdentifyInPhoto,
  buildPropertyContext,
  PROPERTY_QA_SYSTEM_PROMPT,
  type QaProperty,
} from '@/lib/showcase/property-qa';

function makeProp(overrides: Partial<QaProperty> = {}): QaProperty {
  return {
    title: 'HSR 3BHK Apartment',
    type: 'Flat/ Apartment',
    listing_type: 'Sale',
    price: 15000000,
    rent_per_month: null,
    maintenance: null,
    advance: null,
    gst: null,
    location: 'HSR Layout',
    sublocality: 'Sector 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    bedrooms: 3,
    bathrooms: 2,
    area_sqft: 1450,
    area_unit: 'sq.ft.',
    super_built_area: undefined,
    land_area: undefined,
    land_area_unit: undefined,
    facing_direction: 'East',
    features: ['Gym', 'Swimming Pool', 'Covered Parking'],
    nearby_highlights: ['Metro 500m', 'DPS School 1km'],
    property_code: 'CR-1042',
    project: 'Prestige Heights',
    rental_income: null,
    roi: null,
    dimensions: undefined,
    ...overrides,
  };
}

describe('answerFromPropertyData — structured answers', () => {
  it('answers price for a sale listing', () => {
    const r = answerFromPropertyData('how much is this property?', makeProp());
    expect(r.intent).toBe('price');
    expect(r.answer).toBe('The asking price is ₹1.50 Cr.');
  });

  it('answers rent (with maintenance) for a rent listing', () => {
    const prop = makeProp({
      listing_type: 'Rent',
      price: 0,
      rent_per_month: 35000,
      maintenance: 2000,
    });
    const r = answerFromPropertyData('what is the rent?', prop);
    expect(r.intent).toBe('price');
    expect(r.answer).toContain('The monthly rent is ₹35,000.');
    expect(r.answer).toContain('Maintenance is ₹2,000/month.');
  });

  it('answers bedroom count', () => {
    expect(
      answerFromPropertyData('how many bedrooms?', makeProp()).answer
    ).toBe("It's a 3 BHK.");
  });

  it('answers bathroom count with pluralization', () => {
    expect(answerFromPropertyData('bathrooms?', makeProp()).answer).toBe(
      'It has 2 bathrooms.'
    );
    expect(
      answerFromPropertyData('bathroom?', makeProp({ bathrooms: 1 })).answer
    ).toBe('It has 1 bathroom.');
  });

  it('answers area/size', () => {
    const r = answerFromPropertyData('what is the size?', makeProp());
    expect(r.intent).toBe('area');
    expect(r.answer).toContain('1,450 sq.ft. built-up');
  });

  it('answers location and de-dupes repeated place names', () => {
    const r = answerFromPropertyData(
      'where is it located?',
      makeProp({
        location: 'Bengaluru',
        sublocality: 'HSR',
        city: 'Bengaluru',
        state: undefined,
      })
    );
    expect(r.intent).toBe('location');
    expect(r.answer).toBe("It's located in Bengaluru, HSR.");
  });

  it('answers amenities', () => {
    expect(
      answerFromPropertyData('what amenities does it have?', makeProp()).answer
    ).toContain('Gym, Swimming Pool, Covered Parking');
  });

  it('answers facing direction', () => {
    expect(
      answerFromPropertyData('which direction does it face?', makeProp()).answer
    ).toBe('It faces East.');
  });

  it('answers nearby highlights', () => {
    expect(
      answerFromPropertyData('what is nearby?', makeProp()).answer
    ).toContain('Metro 500m, DPS School 1km');
  });

  it('answers property type + sale/rent', () => {
    expect(
      answerFromPropertyData('what type of property is it?', makeProp()).answer
    ).toBe('This is a Flat/ Apartment listed for sale.');
  });

  it('prioritizes ROI intent over price for "rental income"', () => {
    const prop = makeProp({ rental_income: 40000, roi: 3.2 });
    const r = answerFromPropertyData('what is the rental income?', prop);
    expect(r.intent).toBe('roi');
    expect(r.answer).toContain('expected rental income ₹40,000/month');
    expect(r.answer).toContain('ROI/yield 3.2%'.replace('yield', 'yield'));
  });
});

describe('answerFromPropertyData — escalation to AI (null answer)', () => {
  it('returns null for an unmatched open-ended question', () => {
    expect(
      answerFromPropertyData('is the price negotiable?', makeProp())
    ).toEqual({ answer: null, intent: null });
  });

  it('returns null for a question we have no field for (floor)', () => {
    expect(answerFromPropertyData('which floor is it on?', makeProp())).toEqual(
      { answer: null, intent: null }
    );
  });

  it('escalates when the matched intent has no data (bedrooms on a plot)', () => {
    const plot = makeProp({
      type: 'Residential Land/ Plot',
      bedrooms: undefined,
    });
    const r = answerFromPropertyData('how many bedrooms?', plot);
    expect(r.intent).toBe('bedrooms');
    expect(r.answer).toBeNull();
  });

  it('returns null for an empty question', () => {
    expect(answerFromPropertyData('   ', makeProp())).toEqual({
      answer: null,
      intent: null,
    });
  });
});

describe('buildPropertyContext', () => {
  it('includes core fields and omits absent ones', () => {
    const ctx = buildPropertyContext(makeProp());
    expect(ctx).toContain('Title: HSR 3BHK Apartment');
    expect(ctx).toContain('Price: ₹1.50 Cr');
    expect(ctx).toContain('Bedrooms (BHK): 3');
    expect(ctx).toContain('Amenities: Gym, Swimming Pool, Covered Parking');
    expect(ctx).not.toContain('Land area');
    expect(ctx).not.toContain('Rent (per month)');
  });

  it('shows rent fields (not price) for a rental listing', () => {
    const ctx = buildPropertyContext(
      makeProp({ listing_type: 'Rent', price: 0, rent_per_month: 35000 })
    );
    expect(ctx).toContain('Rent (per month): ₹35,000');
    expect(ctx).not.toContain('Price:');
  });
});

// The JP Nagar thread of 7 October 2026: a buyer asked "Is this
// available for sale?" about a plot that had been Under Contract for
// nine days and was told "yes"; then asked "is it this pink house or
// the house next to it?" and was told nothing at all.
describe('[INB-032] availability is answered from the listing status', () => {
  const underContract = () =>
    makeProp({
      title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      type: 'Commercial Land',
      price: 84000000,
      status: 'Under Contract',
    });

  it.each([
    'Is this available for sale ?',
    'is it still available',
    'Still on the market?',
    'Has this been sold?',
    'Is the plot under contract',
    'can I still buy this',
    'is it already taken',
    'Is this still open?',
  ])('answers "%s" from the status, never the model', (q) => {
    const r = answerFromPropertyData(q, underContract());
    expect(r.intent).toBe('availability');
    expect(r.answer).toMatch(/under contract with another buyer/);
    expect(r.answer).not.toMatch(/currently available/);
  });

  it('confirms an available sale listing, and a rental as for rent', () => {
    expect(
      answerFromPropertyData(
        'is this available?',
        makeProp({ status: 'Available' })
      ).answer
    ).toBe('Yes, this property is currently available for sale.');
    expect(
      answerFromPropertyData(
        'is it still available for rent',
        makeProp({
          status: 'Available',
          listing_type: 'Rent',
          rent_per_month: 35000,
        })
      ).answer
    ).toBe('Yes, this property is currently available for rent.');
  });

  it('treats a row without a status as available rather than escalating', () => {
    const r = answerFromPropertyData('is this available', makeProp());
    expect(r.intent).toBe('availability');
    expect(r.answer).toMatch(/^Yes, this property is currently available/);
  });

  it('says sold is sold, and never promises an update on it', () => {
    const r = answerFromPropertyData(
      'still available?',
      makeProp({ status: 'Sold' })
    );
    expect(r.answer).toMatch(/already been sold/);
    expect(r.answer).not.toMatch(/update you/);
  });

  it('tells a buyer the price of an under-contract listing together with its status', () => {
    const r = answerFromPropertyData('how much is it?', underContract());
    expect(r.intent).toBe('price');
    expect(r.answer).toBe(
      'The asking price is ₹8.40 Cr. Please note: this property is currently under contract with another buyer, but the deal is not closed yet.'
    );
  });

  it('adds no caveat to an available listing', () => {
    const r = answerFromPropertyData(
      'how much is it?',
      makeProp({ status: 'Available' })
    );
    expect(r.answer).toBe('The asking price is ₹1.50 Cr.');
  });

  it('puts the availability into the model grounding, worded as not available', () => {
    const ctx = buildPropertyContext(underContract());
    expect(ctx).toContain(
      'Availability: NOT available — currently under contract with another buyer, but the deal is not closed yet'
    );
    expect(buildPropertyContext(makeProp({ status: 'Available' }))).toContain(
      'Availability: Available'
    );
    expect(
      buildPropertyContext(makeProp({ status: 'Pending Review' }))
    ).toContain('Availability: Not yet confirmed');
    expect(PROPERTY_QA_SYSTEM_PROMPT).toMatch(
      /Availability line is authoritative/
    );
  });
});

describe('[INB-032] a question only a person can answer from the photo', () => {
  it.each([
    'Is it this pink house or house next to it ?',
    'which one is it in the photo',
    'is it the one on the left or right',
    'the blue building in the picture?',
    'Which plot is it, the corner one?',
  ])('escalates "%s" without a structured answer', (q) => {
    expect(asksToIdentifyInPhoto(q)).toBe(true);
    const r = answerFromPropertyData(
      q,
      makeProp({ type: 'Independent House' })
    );
    expect(r.answer).toBeNull();
    expect(r.intent).toBe('photo_identification');
  });

  it('leaves ordinary type and photo questions alone', () => {
    for (const q of [
      'is it a villa or an apartment?',
      'can you send photos',
      'which direction does it face',
      'is this house 3 BHK?',
    ]) {
      expect(asksToIdentifyInPhoto(q), q).toBe(false);
    }
  });
});

describe('[INB-032] prices and places read the way the listing message wrote them', () => {
  it('quotes the price in crore, as the inventory card and the share message do', () => {
    const r = answerFromPropertyData(
      'what is the price',
      makeProp({ price: 84000000 })
    );
    expect(r.answer).toBe('The asking price is ₹8.40 Cr.');
    expect(buildPropertyContext(makeProp({ price: 84000000 }))).toContain(
      'Price: ₹8.40 Cr'
    );
    expect(buildPropertyContext(makeProp({ price: 4500000 }))).toContain(
      'Price: ₹45 Lakhs'
    );
  });

  it('does not repeat a locality the location line already carries', () => {
    const prop = makeProp({
      location: 'JP Nagar 4th Phase, Bangalore',
      sublocality: 'JP Nagar 4th Phase',
      city: 'Bangalore',
      state: 'Karnataka',
    });
    expect(buildPropertyContext(prop)).toContain(
      'Location: JP Nagar 4th Phase, Bangalore, Karnataka'
    );
    expect(answerFromPropertyData('where is it located', prop).answer).toBe(
      "It's located in JP Nagar 4th Phase, Bangalore, Karnataka."
    );
  });
});
