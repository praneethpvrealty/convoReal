import { describe, expect, it } from 'vitest';

import {
  emptyPropertyFormValues,
  validatePropertyForm,
  type PropertyFormValues,
} from '@/lib/inventory/property-form-state';
import {
  propertyFormErrorFieldIds,
  propertyFormIsDirty,
} from '@/lib/inventory/property-form-dirty';

function values(overrides: Partial<PropertyFormValues> = {}) {
  return { ...emptyPropertyFormValues(null), ...overrides };
}

describe('[UIX-032] propertyFormIsDirty', () => {
  it('[UIX-032] is clean until a saved field changes', () => {
    const baseline = values({ title: '3BHK in Indiranagar' });
    expect(propertyFormIsDirty(baseline, { ...baseline }, true)).toBe(false);
    expect(
      propertyFormIsDirty(baseline, { ...baseline, price: '9000000' }, true)
    ).toBe(true);
  });

  it('[UIX-032] counts a new photo as a change', () => {
    const baseline = values();
    expect(
      propertyFormIsDirty(
        baseline,
        { ...baseline, images: ['property-images/a/img-1.jpg'] },
        false
      )
    ).toBe(true);
  });

  it('[UIX-032] ignores the order of interested contacts and an unset baseline', () => {
    const baseline = values({ interestedContactIds: ['a', 'b'] });
    expect(
      propertyFormIsDirty(
        baseline,
        { ...baseline, interestedContactIds: ['b', 'a'] },
        true
      )
    ).toBe(false);
    expect(propertyFormIsDirty(null, values({ title: 'x' }), true)).toBe(false);
  });
});

describe('[UIX-040] propertyFormErrorFieldIds', () => {
  it('[UIX-040] points a missing title at the title input', () => {
    const v = values();
    const error = validatePropertyForm(v)!;
    expect(propertyFormErrorFieldIds(error, v)).toEqual(['prop-title']);
  });

  it('[UIX-040] points a bad price at the price input for each listing type', () => {
    const sale = values({ title: 'Plot', price: '-1' });
    expect(
      propertyFormErrorFieldIds(validatePropertyForm(sale)!, sale)
    ).toEqual(['prop-price']);
    const rent = values({ title: 'Flat', listingType: 'Rent' });
    expect(
      propertyFormErrorFieldIds(validatePropertyForm(rent)!, rent)
    ).toEqual(['prop-rent']);
    const bts = values({ title: 'Shed', listingType: 'Built to Suit' });
    expect(propertyFormErrorFieldIds(validatePropertyForm(bts)!, bts)).toEqual([
      'prop-bts-rent',
    ]);
  });

  it('[UIX-040] points a missing location at the first empty location field', () => {
    const v = values({ title: 'Villa', price: '100', city: 'Bengaluru' });
    const error = validatePropertyForm(v)!;
    expect(error).toMatch(/^Location search query/);
    expect(propertyFormErrorFieldIds(error, v)).toEqual([
      'prop-search-query',
      'prop-state',
    ]);
  });

  it('[UIX-040] points a JV share error at the owner share input', () => {
    const v = values({ title: 'JV land', listingType: 'JV/JD' });
    const error = validatePropertyForm(v)!;
    expect(propertyFormErrorFieldIds(error, v)).toEqual([
      'prop-jv-owner-share',
    ]);
  });

  it('returns nothing for a message it does not know', () => {
    expect(propertyFormErrorFieldIds('Something else', values())).toEqual([]);
  });
});
