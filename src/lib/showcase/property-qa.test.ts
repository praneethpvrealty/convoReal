import { describe, it, expect } from 'vitest';
import {
  answerFromPropertyData,
  buildPropertyContext,
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
    expect(r.answer).toBe('The asking price is ₹1,50,00,000.');
  });

  it('answers rent (with maintenance) for a rent listing', () => {
    const prop = makeProp({ listing_type: 'Rent', price: 0, rent_per_month: 35000, maintenance: 2000 });
    const r = answerFromPropertyData('what is the rent?', prop);
    expect(r.intent).toBe('price');
    expect(r.answer).toContain('The monthly rent is ₹35,000.');
    expect(r.answer).toContain('Maintenance is ₹2,000/month.');
  });

  it('answers bedroom count', () => {
    expect(answerFromPropertyData('how many bedrooms?', makeProp()).answer).toBe("It's a 3 BHK.");
  });

  it('answers bathroom count with pluralization', () => {
    expect(answerFromPropertyData('bathrooms?', makeProp()).answer).toBe('It has 2 bathrooms.');
    expect(answerFromPropertyData('bathroom?', makeProp({ bathrooms: 1 })).answer).toBe('It has 1 bathroom.');
  });

  it('answers area/size', () => {
    const r = answerFromPropertyData('what is the size?', makeProp());
    expect(r.intent).toBe('area');
    expect(r.answer).toContain('1,450 sq.ft. built-up');
  });

  it('answers location and de-dupes repeated place names', () => {
    const r = answerFromPropertyData('where is it located?', makeProp({ location: 'Bengaluru', sublocality: 'HSR', city: 'Bengaluru', state: undefined }));
    expect(r.intent).toBe('location');
    expect(r.answer).toBe("It's located in Bengaluru, HSR.");
  });

  it('answers amenities', () => {
    expect(answerFromPropertyData('what amenities does it have?', makeProp()).answer).toContain('Gym, Swimming Pool, Covered Parking');
  });

  it('answers facing direction', () => {
    expect(answerFromPropertyData('which direction does it face?', makeProp()).answer).toBe('It faces East.');
  });

  it('answers nearby highlights', () => {
    expect(answerFromPropertyData('what is nearby?', makeProp()).answer).toContain('Metro 500m, DPS School 1km');
  });

  it('answers property type + sale/rent', () => {
    expect(answerFromPropertyData('what type of property is it?', makeProp()).answer).toBe('This is a Flat/ Apartment listed for sale.');
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
    expect(answerFromPropertyData('is the price negotiable?', makeProp())).toEqual({ answer: null, intent: null });
  });

  it('returns null for a question we have no field for (floor)', () => {
    expect(answerFromPropertyData('which floor is it on?', makeProp())).toEqual({ answer: null, intent: null });
  });

  it('escalates when the matched intent has no data (bedrooms on a plot)', () => {
    const plot = makeProp({ type: 'Residential Land/ Plot', bedrooms: undefined });
    const r = answerFromPropertyData('how many bedrooms?', plot);
    expect(r.intent).toBe('bedrooms');
    expect(r.answer).toBeNull();
  });

  it('returns null for an empty question', () => {
    expect(answerFromPropertyData('   ', makeProp())).toEqual({ answer: null, intent: null });
  });
});

describe('buildPropertyContext', () => {
  it('includes core fields and omits absent ones', () => {
    const ctx = buildPropertyContext(makeProp());
    expect(ctx).toContain('Title: HSR 3BHK Apartment');
    expect(ctx).toContain('Price: ₹1,50,00,000');
    expect(ctx).toContain('Bedrooms (BHK): 3');
    expect(ctx).toContain('Amenities: Gym, Swimming Pool, Covered Parking');
    expect(ctx).not.toContain('Land area');
    expect(ctx).not.toContain('Rent (per month)');
  });

  it('shows rent fields (not price) for a rental listing', () => {
    const ctx = buildPropertyContext(makeProp({ listing_type: 'Rent', price: 0, rent_per_month: 35000 }));
    expect(ctx).toContain('Rent (per month): ₹35,000');
    expect(ctx).not.toContain('Price:');
  });
});
