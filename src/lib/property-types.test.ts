import { describe, it, expect } from 'vitest';
import { normalizePropertyType, PROPERTY_TYPE_VALUES } from './property-types';

describe('normalizePropertyType', () => {
  it('maps mixed-use / whole commercial buildings to Commercial Building', () => {
    // The PROP-1093 case: a mixed-use development mentioning offices,
    // hotel and hypermarket must NOT collapse into offices/apartments.
    expect(
      normalizePropertyType('Mixed-Use Commercial Development with Hypermarket, Hotel, Offices, Gym & Penthouse'),
    ).toBe('Commercial Building');
    expect(normalizePropertyType('Commercial Building')).toBe('Commercial Building');
    expect(normalizePropertyType('commercial complex')).toBe('Commercial Building');
    expect(normalizePropertyType('Hotel building for sale')).toBe('Commercial Building');
  });

  it('still maps plain commercial subtypes to their own values', () => {
    expect(normalizePropertyType('office space')).toBe('Commercial Office Space');
    expect(normalizePropertyType('showroom')).toBe('Commercial Showroom');
    expect(normalizePropertyType('commercial land')).toBe('Commercial Land');
    expect(normalizePropertyType('flat')).toBe('Flat/ Apartment');
  });

  it('includes Commercial Building in the canonical taxonomy', () => {
    expect(PROPERTY_TYPE_VALUES).toContain('Commercial Building');
  });
});
