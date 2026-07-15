import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildInventorySummary,
  buildSummaryLine,
  categoryForType,
} from './inventory-summary-builder';

function prop(overrides: Partial<Property>): Property {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'a1',
    user_id: 'u1',
    title: 'Untitled',
    price: 0,
    location: 'Bangalore',
    type: 'Residential Land/ Plot',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    ...overrides,
  } as Property;
}

const PORTAL = 'https://www.convoreal.com/?ref=acc-1';

describe('categoryForType', () => {
  it('maps known subtypes to their category', () => {
    expect(categoryForType('Villa')).toBe('Residential');
    expect(categoryForType('Warehouse/ Godown')).toBe('Commercial');
    expect(categoryForType('Industrial Land')).toBe('Commercial');
    expect(categoryForType('Agricultural Land')).toBe('Agricultural');
  });

  it('resolves Farm House (in two lists) to Residential and unknowns to Other', () => {
    expect(categoryForType('Farm House')).toBe('Residential');
    expect(categoryForType('Spaceport')).toBe('Other');
    expect(categoryForType(null)).toBe('Other');
  });
});

describe('buildSummaryLine', () => {
  it('renders title | short type | area | price | BHK | locality', () => {
    const line = buildSummaryLine(
      prop({
        title: 'Sumadhura Eden Garden',
        type: 'Flat/ Apartment',
        area_sqft: 1380,
        price: 17000000,
        bedrooms: 2.5,
        sublocality: 'Kannamangala',
        city: 'Bangalore',
      }),
    );
    expect(line).toBe(
      '*Sumadhura Eden Garden* | Apartment | 1,380 Sq.Ft. | ₹1.70 Cr | 2.5 BHK | Kannamangala',
    );
  });

  it('omits missing segments instead of leaving empty pipes', () => {
    const line = buildSummaryLine(
      prop({ title: 'Golden City', type: 'Residential Land/ Plot', land_area: 1500, land_area_unit: 'Sq.Ft.' }),
    );
    expect(line).toBe('*Golden City* | Plot | 1,500 Sq.Ft.');
    expect(line).not.toContain('||');
  });

  it('shows monthly rent for rent listings and rental income + ROI for sale listings', () => {
    const rent = buildSummaryLine(
      prop({ title: 'Office A', type: 'Commercial Office Space', listing_type: 'Rent', rent_per_month: 250000 }),
    );
    expect(rent).toContain('₹2.50 Lakhs/mo rent');

    const invest = buildSummaryLine(
      prop({ title: 'Shop B', type: 'Commercial Shop', price: 20000000, rental_income: 120000, roi: 7.2 }),
    );
    expect(invest).toContain('₹2 Cr');
    expect(invest).toContain('Rental ₹1.20 Lakhs/mo');
    expect(invest).toContain('ROI 7.2%');
  });
});

describe('buildInventorySummary', () => {
  const properties = [
    prop({ title: 'Villa One', type: 'Villa', price: 60000000, sublocality: 'Kannamangala' }),
    prop({ title: 'Plot One', type: 'Residential Land/ Plot', price: 4400000, sublocality: 'Bangalore South' }),
    prop({ title: 'Office One', type: 'Commercial Office Space', price: 14500000, sublocality: 'KR Puram' }),
    prop({ title: 'Farm One', type: 'Agricultural Land', price: 30000000, sublocality: 'Devanahalli' }),
  ];

  it('groups listings under category headers in fixed order with per-section numbering', () => {
    const msg = buildInventorySummary(properties, { portalUrl: PORTAL });
    const resIdx = msg.indexOf('*RESIDENTIAL*');
    const comIdx = msg.indexOf('*COMMERCIAL*');
    const agrIdx = msg.indexOf('*AGRICULTURAL*');
    expect(resIdx).toBeGreaterThan(-1);
    expect(comIdx).toBeGreaterThan(resIdx);
    expect(agrIdx).toBeGreaterThan(comIdx);
    expect(msg).toContain('1. *Villa One*');
    expect(msg).toContain('2. *Plot One*');
    expect(msg).toContain('1. *Office One*'); // numbering restarts per section
    expect(msg).toContain(PORTAL);
  });

  it('filters to a single category when asked', () => {
    const msg = buildInventorySummary(properties, { portalUrl: PORTAL, category: 'Commercial' });
    expect(msg).toContain('*COMMERCIAL*');
    expect(msg).not.toContain('*RESIDENTIAL*');
    expect(msg).not.toContain('Villa One');
  });

  it('caps each section and reports the overflow', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      prop({ title: `Villa ${i}`, type: 'Villa', price: 10000000 }),
    );
    const msg = buildInventorySummary(many, { portalUrl: PORTAL, maxPerCategory: 10 });
    expect(msg).toContain('10. *Villa 9*');
    expect(msg).not.toContain('Villa 10');
    expect(msg).toContain('_+2 more Residential listings on the portal_');
  });

  it('returns empty string when nothing matches', () => {
    expect(buildInventorySummary([], { portalUrl: PORTAL })).toBe('');
    expect(
      buildInventorySummary(properties, { portalUrl: PORTAL, category: 'Agricultural', maxPerCategory: 10 }),
    ).toContain('Farm One');
  });
});
