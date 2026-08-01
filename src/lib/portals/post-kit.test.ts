import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  PORTALS,
  clampText,
  buildPortalDescription,
  buildPortalFields,
  parseDimensions,
  missingRequiredFields,
} from './post-kit';

const saleProperty = {
  id: 'p1',
  title:
    '15000 sqft Residential Land in Koramangala with a very long tail that keeps going and going beyond limits',
  description:
    'Prime corner residential land parcel.\nSee https://example.com/secret-link for more.',
  type: 'Residential Land/ Plot',
  listing_type: 'Sale',
  price: 450000000,
  location: 'Koramangala',
  sublocality: 'Koramangala 3rd Block',
  city: 'Bangalore',
  state: 'Karnataka',
  land_area: 15000,
  land_area_unit: 'sqft',
  facing_direction: 'East',
  road_width: 60,
  road_width_unit: 'ft',
  features: ['Corner plot', 'Clear title'],
  nearby_highlights: ['Forum Mall 1km'],
  images: [],
  is_published: true,
} as unknown as Property;

describe('clampText', () => {
  it('leaves short text untouched and clamps long text with ellipsis', () => {
    expect(clampText('short', 10)).toBe('short');
    const clamped = clampText('a'.repeat(100), 70);
    expect(clamped.length).toBeLessThanOrEqual(70);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('buildPortalDescription', () => {
  it('includes specs, features, and nearby but strips URLs', () => {
    const desc = buildPortalDescription(saleProperty, '99acres');
    expect(desc).toContain('Prime corner residential land parcel.');
    expect(desc).toContain('15000 sqft');
    expect(desc).toContain('East facing');
    expect(desc).toContain('Highlights: Corner plot, Clear title.');
    expect(desc).toContain('Nearby: Forum Mall 1km.');
    expect(desc).not.toContain('https://');
    expect(desc).not.toContain('*');
  });
});

describe('buildPortalFields', () => {
  it('orders core fields and clamps the title to the portal limit', () => {
    const fields = buildPortalFields(saleProperty, '99acres');
    const labels = fields.map((f) => f.label);
    expect(labels.slice(0, 5)).toEqual([
      'Listing For',
      'Property Type',
      'City',
      'Locality',
      'Title',
    ]);
    const title = fields.find((f) => f.label === 'Title')!.value;
    expect(title.length).toBeLessThanOrEqual(PORTALS['99acres'].maxTitle);
    expect(fields.find((f) => f.label === 'Expected Price')!.value).toBe(
      '₹45 Cr'
    );
    expect(fields.find((f) => f.label === 'Plot Area')!.value).toBe(
      '15000 sqft'
    );
  });

  it('uses rent fields for rental listings', () => {
    const rental = {
      ...saleProperty,
      listing_type: 'Rent',
      rent_per_month: 85000,
      maintenance: 5000,
      advance: 500000,
      type: '3 BHK Apartment',
      area_sqft: 1850,
      area_unit: 'Sq.Ft.',
      land_area: null,
    } as unknown as Property;
    const fields = buildPortalFields(rental, 'magicbricks');
    expect(fields.find((f) => f.label === 'Listing For')!.value).toBe(
      'Rent / Lease'
    );
    expect(fields.find((f) => f.label === 'Monthly Rent')!.value).toBe(
      '₹85,000'
    );
    expect(
      fields.find((f) => f.label === 'Security Deposit / Advance')!.value
    ).toBe('₹5 Lakhs');
    expect(fields.find((f) => f.label === 'Built-up Area')!.value).toBe(
      '1850 Sq.Ft.'
    );
  });

  it('drops fields with no value', () => {
    const fields = buildPortalFields(saleProperty, 'housing');
    expect(fields.some((f) => f.label === 'Bedrooms')).toBe(false);
    expect(fields.every((f) => f.value.trim().length > 0)).toBe(true);
  });

  it('adds Housing mandatory defaults and derived plot extras', () => {
    const withDims = {
      ...saleProperty,
      dimensions: '100 x 150 ft',
    } as unknown as Property;
    const fields = buildPortalFields(withDims, 'housing');
    const get = (label: string) => fields.find((f) => f.label === label)?.value;
    expect(get('Transaction Type')).toBe('Resale');
    expect(get('Possession Status')).toBe('Immediate');
    expect(get('Age of Property')).toBe('1');
    expect(get('Area Unit')).toBe('sqft');
    expect(get('Charge Brokerage')).toBe('Yes');
    expect(get('Brokerage')).toBe('₹45 Lakhs'); // 1% of ₹45 Cr
    expect(get('Length')).toBe('100');
    expect(get('Width')).toBe('150');
    expect(get('Width of Facing Road')).toBe('60');
    expect(get('Boundary Wall')).toBe('Yes');
    expect(get('Open Sides')).toBe('1');
    // Extras stay ahead of the description.
    const labels = fields.map((f) => f.label);
    expect(labels.indexOf('Transaction Type')).toBeLessThan(
      labels.indexOf('Description')
    );
  });

  it('customises extras per portal in each portal’s vocabulary', () => {
    const flat = {
      ...saleProperty,
      type: '3 BHK Apartment',
      bedrooms: 3,
      area_sqft: 1850,
      area_unit: 'Sq.Ft.',
      land_area: null,
    } as unknown as Property;

    const acres = buildPortalFields(flat, '99acres');
    const getAcres = (label: string) =>
      acres.find((f) => f.label === label)?.value;
    expect(getAcres('Availability Status')).toBe('Ready to Move');
    expect(getAcres('Age of Property')).toBe('1');
    expect(getAcres('Furnishing')).toBe('Unfurnished');
    expect(getAcres('Balconies')).toBe('1');
    expect(getAcres('Ownership')).toBe('Freehold');
    expect(getAcres('Charge Brokerage')).toBe('Yes');
    expect(acres.some((f) => f.label === 'Transaction Type')).toBe(false);
    expect(acres.some((f) => f.label === 'Possession Status')).toBe(false);

    const mb = buildPortalFields(flat, 'magicbricks');
    const getMb = (label: string) => mb.find((f) => f.label === label)?.value;
    expect(getMb('Transaction Type')).toBe('Resale');
    expect(getMb('Availability Status')).toBe('Ready to Move');
    expect(getMb('Furnishing')).toBe('Unfurnished');
    expect(mb.some((f) => f.label === 'Ownership')).toBe(false);

    expect(
      buildPortalFields(flat, 'housing').some(
        (f) => f.label === 'Availability Status'
      )
    ).toBe(false);
  });

  it('sends stored unit details instead of the review-and-fix defaults', () => {
    const flat = {
      ...saleProperty,
      type: '3 BHK Apartment',
      bedrooms: 3,
      area_sqft: 1850,
      area_unit: 'Sq.Ft.',
      land_area: null,
      furnishing: 'Semi-Furnished',
      balconies: 2,
      floor_number: 4,
      total_floors: 12,
    } as unknown as Property;

    for (const portal of ['99acres', 'magicbricks', 'housing'] as const) {
      const fields = buildPortalFields(flat, portal);
      const get = (label: string) =>
        fields.find((f) => f.label === label)?.value;
      expect(get('Furnishing')).toBe('Semi-Furnished');
      expect(get('Balconies')).toBe('2');
      expect(get('Floor No.')).toBe('4');
      expect(get('Total Floors')).toBe('12');
    }

    const land = buildPortalFields(
      {
        ...saleProperty,
        floor_number: 0,
        total_floors: 1,
      } as unknown as Property,
      '99acres'
    );
    expect(land.some((f) => f.label === 'Floor No.')).toBe(false);
    expect(land.some((f) => f.label === 'Total Floors')).toBe(false);
  });

  it('skips age/furnishing extras for land and furnishing/balconies for commercial', () => {
    const acresLand = buildPortalFields(saleProperty, '99acres');
    const getLand = (label: string) =>
      acresLand.find((f) => f.label === label)?.value;
    expect(acresLand.some((f) => f.label === 'Age of Property')).toBe(false);
    expect(acresLand.some((f) => f.label === 'Furnishing')).toBe(false);
    expect(acresLand.some((f) => f.label === 'Balconies')).toBe(false);
    expect(getLand('Ownership')).toBe('Freehold');
    expect(getLand('Boundary Wall')).toBe('Yes');
    expect(getLand('Width of Facing Road')).toBe('60');

    const commercial = {
      ...saleProperty,
      type: 'Commercial Building',
      area_sqft: 3600,
      land_area: null,
    } as unknown as Property;
    const mb = buildPortalFields(commercial, 'magicbricks');
    expect(mb.find((f) => f.label === 'Age of Property')?.value).toBe('1');
    expect(mb.some((f) => f.label === 'Furnishing')).toBe(false);
    expect(mb.some((f) => f.label === 'Balconies')).toBe(false);
  });

  it('converts metre road width to feet and skips plot extras for non-land', () => {
    const metres = {
      ...saleProperty,
      dimensions: '30x45',
      road_width: 12,
      road_width_unit: 'm',
    } as unknown as Property;
    expect(
      buildPortalFields(metres, 'housing').find(
        (f) => f.label === 'Width of Facing Road'
      )!.value
    ).toBe('39');

    const flat = {
      ...saleProperty,
      type: '3 BHK Apartment',
      area_sqft: 1850,
      area_unit: 'Sq.Ft.',
      land_area: null,
    } as unknown as Property;
    const flatFields = buildPortalFields(flat, 'housing');
    expect(flatFields.some((f) => f.label === 'Boundary Wall')).toBe(false);
    expect(flatFields.some((f) => f.label === 'Length')).toBe(false);
    expect(flatFields.find((f) => f.label === 'Age of Property')!.value).toBe(
      '1'
    );
  });

  it('defaults brokerage to one month rent on rental listings', () => {
    const rental = {
      ...saleProperty,
      listing_type: 'Rent',
      rent_per_month: 85000,
      type: '3 BHK Apartment',
      area_sqft: 1850,
      land_area: null,
    } as unknown as Property;
    const fields = buildPortalFields(rental, 'housing');
    expect(fields.find((f) => f.label === 'Charge Brokerage')!.value).toBe(
      'Yes'
    );
    expect(fields.find((f) => f.label === 'Brokerage')!.value).toBe('₹85,000');
  });
});

describe('parseDimensions', () => {
  it('parses common dimension formats', () => {
    expect(parseDimensions('100 x 150')).toEqual({
      length: '100',
      width: '150',
    });
    expect(parseDimensions('40X60')).toEqual({ length: '40', width: '60' });
    expect(parseDimensions('100ft x 150ft')).toEqual({
      length: '100',
      width: '150',
    });
    expect(parseDimensions('irregular')).toBeNull();
    expect(parseDimensions(undefined)).toBeNull();
  });
});

describe('missingRequiredFields', () => {
  it('reports nothing for a complete land listing', () => {
    expect(missingRequiredFields(saleProperty)).toEqual([]);
  });

  it('lists the portal-mandatory fields that are empty', () => {
    const bare = {
      ...saleProperty,
      city: '',
      description: '',
      price: 0,
    } as unknown as Property;
    const missing = missingRequiredFields(bare);
    expect(missing).toContain('City');
    expect(missing).toContain('Description');
    expect(missing).toContain('Expected Price');
  });

  it('requires bedrooms for a residential non-land property but not for commercial', () => {
    const flat = {
      ...saleProperty,
      type: '3 BHK Apartment',
      area_sqft: 1850,
      land_area: null,
    } as unknown as Property;
    expect(missingRequiredFields(flat)).toContain('Bedrooms');

    const commercial = {
      ...saleProperty,
      type: 'Commercial Building',
      area_sqft: 3600,
      land_area: null,
    } as unknown as Property;
    expect(missingRequiredFields(commercial)).not.toContain('Bedrooms');
  });
});
