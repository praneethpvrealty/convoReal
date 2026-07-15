import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  PORTALS,
  clampText,
  buildPortalDescription,
  buildPortalFields,
  parseDimensions,
} from './post-kit';

const saleProperty = {
  id: 'p1',
  title: '15000 sqft Residential Land in Koramangala with a very long tail that keeps going and going beyond limits',
  description: 'Prime corner residential land parcel.\nSee https://example.com/secret-link for more.',
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
    expect(labels.slice(0, 5)).toEqual(['Listing For', 'Property Type', 'City', 'Locality', 'Title']);
    const title = fields.find((f) => f.label === 'Title')!.value;
    expect(title.length).toBeLessThanOrEqual(PORTALS['99acres'].maxTitle);
    expect(fields.find((f) => f.label === 'Expected Price')!.value).toBe('₹45 Cr');
    expect(fields.find((f) => f.label === 'Plot Area')!.value).toBe('15000 sqft');
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
    expect(fields.find((f) => f.label === 'Listing For')!.value).toBe('Rent / Lease');
    expect(fields.find((f) => f.label === 'Monthly Rent')!.value).toBe('₹85,000');
    expect(fields.find((f) => f.label === 'Security Deposit / Advance')!.value).toBe('₹5 Lakhs');
    expect(fields.find((f) => f.label === 'Built-up Area')!.value).toBe('1850 Sq.Ft.');
  });

  it('drops fields with no value', () => {
    const fields = buildPortalFields(saleProperty, 'housing');
    expect(fields.some((f) => f.label === 'Bedrooms')).toBe(false);
    expect(fields.every((f) => f.value.trim().length > 0)).toBe(true);
  });

  it('adds Housing mandatory defaults, derived plot extras — housing only', () => {
    const withDims = { ...saleProperty, dimensions: '100 x 150 ft' } as unknown as Property;
    const fields = buildPortalFields(withDims, 'housing');
    const get = (label: string) => fields.find((f) => f.label === label)?.value;
    expect(get('Transaction Type')).toBe('Resale');
    expect(get('Possession Status')).toBe('Immediate');
    expect(get('Age of Property')).toBe('1');
    expect(get('Area Unit')).toBe('sqft');
    expect(get('Length')).toBe('100');
    expect(get('Width')).toBe('150');
    expect(get('Width of Facing Road')).toBe('60');
    expect(get('Boundary Wall')).toBe('Yes');
    expect(get('Open Sides')).toBe('1');
    // Extras stay ahead of the description, and off other portals.
    const labels = fields.map((f) => f.label);
    expect(labels.indexOf('Transaction Type')).toBeLessThan(labels.indexOf('Description'));
    expect(buildPortalFields(withDims, '99acres').some((f) => f.label === 'Age of Property')).toBe(false);
  });

  it('converts metre road width to feet and skips plot extras for non-land', () => {
    const metres = { ...saleProperty, dimensions: '30x45', road_width: 12, road_width_unit: 'm' } as unknown as Property;
    expect(buildPortalFields(metres, 'housing').find((f) => f.label === 'Width of Facing Road')!.value).toBe('39');

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
    expect(flatFields.find((f) => f.label === 'Age of Property')!.value).toBe('1');
  });
});

describe('parseDimensions', () => {
  it('parses common dimension formats', () => {
    expect(parseDimensions('100 x 150')).toEqual({ length: '100', width: '150' });
    expect(parseDimensions('40X60')).toEqual({ length: '40', width: '60' });
    expect(parseDimensions('100ft x 150ft')).toEqual({ length: '100', width: '150' });
    expect(parseDimensions('irregular')).toBeNull();
    expect(parseDimensions(undefined)).toBeNull();
  });
});
