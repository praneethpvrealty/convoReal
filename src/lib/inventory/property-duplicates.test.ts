import { describe, expect, it } from 'vitest';
import { assessPropertyDuplicate } from './property-duplicates';

const listing = {
  latitude: 12.9352,
  longitude: 77.6245,
  type: 'Flat/ Apartment',
  listing_type: 'Sale',
  project: 'Lake View',
  area_sqft: 1500,
  price: 20_000_000,
  floor_number: 3,
};

describe('assessPropertyDuplicate', () => {
  it('flags a nearby listing and explains matching attributes', () => {
    const result = assessPropertyDuplicate(listing, {
      ...listing,
      latitude: 12.93525,
      longitude: 77.6245,
    });

    expect(result?.confidence).toBe('high');
    expect(result?.distanceMeters).toBeLessThan(10);
    expect(result?.signals).toContain('Same project or building');
  });

  it('keeps a different unit as a nearby review candidate', () => {
    const result = assessPropertyDuplicate(listing, {
      ...listing,
      type: 'Commercial Office',
      listing_type: 'Rent',
      project: 'Different Tower',
      area_sqft: 4000,
      price: 500_000,
      floor_number: 7,
      latitude: 12.9357,
    });

    expect(result?.confidence).toBe('nearby');
  });

  it('ignores listings outside 100 metres', () => {
    expect(assessPropertyDuplicate(listing, { ...listing, latitude: 12.937 })).toBeNull();
  });
});
