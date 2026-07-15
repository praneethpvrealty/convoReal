import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  extractAreaSqft,
  extractBedrooms,
  extractLocation,
  inferPropertyType,
  parseDateToken,
  parseHarvestedListing,
  parseIndianAmount,
  parsePortalStatus,
} from './listing-parser';
import {
  groupCrossPortalDuplicates,
  matchListing,
  scoreListingAgainstProperty,
  AUTO_MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  type ExistingPortalLink,
} from './listing-matcher';
import type { ParsedListing } from './types';

function prop(overrides: Partial<Property>): Property {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    account_id: 'a1',
    user_id: 'u1',
    title: 'Untitled',
    price: 0,
    location: 'Bangalore',
    type: 'Flat/ Apartment',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Property;
}

function listing(overrides: Partial<ParsedListing>): ParsedListing {
  return {
    portal: 'magicbricks',
    portalListingId: 'mb-1',
    listingUrl: null,
    rawText: '',
    title: '3 BHK Flat in HSR Layout',
    propertyType: 'Flat/ Apartment',
    listingFor: 'Sale',
    price: 12_500_000,
    bedrooms: 3,
    areaSqft: 1450,
    locality: 'HSR Layout',
    city: 'Bengaluru',
    postedOn: null,
    expiresOn: null,
    portalStatus: 'active',
    views: null,
    responses: null,
    ...overrides,
  };
}

describe('parseIndianAmount', () => {
  it('parses crore, lakh and plain formats', () => {
    expect(parseIndianAmount('₹1.25 Cr')).toBe(12_500_000);
    expect(parseIndianAmount('Rs. 85 Lakh')).toBe(8_500_000);
    expect(parseIndianAmount('₹ 45,00,000')).toBe(4_500_000);
    expect(parseIndianAmount('₹35 K')).toBe(35_000);
    expect(parseIndianAmount('2 Crore')).toBe(20_000_000);
  });

  it('returns null for junk', () => {
    expect(parseIndianAmount('Price on Request')).toBeNull();
    expect(parseIndianAmount('')).toBeNull();
    expect(parseIndianAmount(null)).toBeNull();
  });
});

describe('parser helpers', () => {
  it('extracts bedrooms, area, dates, status, type and location', () => {
    expect(extractBedrooms('Spacious 3 BHK for sale')).toBe(3);
    expect(extractBedrooms('plot of land')).toBeNull();
    expect(extractAreaSqft('1,450 sq.ft built-up')).toBe(1450);
    expect(extractAreaSqft('2 acres farm land')).toBe(87_120);
    expect(parseDateToken('Posted on 12 Jan 2026')).toBe('2026-01-12');
    expect(parseDateToken('12/01/2026')).toBe('2026-01-12');
    expect(parsePortalStatus('This listing has Expired')).toBe('expired');
    expect(parsePortalStatus('Under Screening')).toBe('under_review');
    expect(inferPropertyType('Residential Plot in Sarjapur')).toBe('Residential Land/ Plot');
    expect(inferPropertyType('3 BHK Flat for sale')).toBe('Flat/ Apartment');
    expect(extractLocation('3 BHK in HSR Layout, Bengaluru')).toEqual({ locality: 'HSR Layout', city: 'Bengaluru' });
  });

  it('parses a realistic MagicBricks dashboard card', () => {
    const parsed = parseHarvestedListing('magicbricks', {
      listingId: '74829301',
      listingUrl: 'https://www.magicbricks.com/propertyDetails/74829301',
      rawText: [
        '3 BHK Flat in HSR Layout, Bengaluru',
        '₹1.25 Cr',
        '1450 sqft | 3 Bathrooms',
        'Posted on 10 May 2026 · Expires on 8 Aug 2026',
        '412 Views · 18 Responses',
        'Status: Active',
      ].join('\n'),
    });
    expect(parsed.portalListingId).toBe('74829301');
    expect(parsed.price).toBe(12_500_000);
    expect(parsed.bedrooms).toBe(3);
    expect(parsed.areaSqft).toBe(1450);
    expect(parsed.locality).toBe('HSR Layout');
    expect(parsed.city).toBe('Bengaluru');
    expect(parsed.postedOn).toBe('2026-05-10');
    expect(parsed.expiresOn).toBe('2026-08-08');
    expect(parsed.views).toBe(412);
    expect(parsed.responses).toBe(18);
    expect(parsed.portalStatus).toBe('active');
    expect(parsed.listingFor).toBe('Sale');
  });
});

describe('matchListing — dedup guarantees', () => {
  const inventory3bhk = prop({
    id: 'p-hsr',
    title: 'Luxury 3 BHK Apartment HSR Layout',
    type: 'Flat/ Apartment',
    price: 12_500_000,
    location: 'HSR Layout',
    city: 'Bengaluru',
    bedrooms: 3,
    area_sqft: 1450,
  });

  it('tier 0: already-linked portal listing is linked, never re-imported', () => {
    const links: ExistingPortalLink[] = [
      { property_id: 'p-hsr', portal: 'magicbricks', portal_listing_id: 'mb-1', listing_url: null },
    ];
    const r = matchListing(listing({}), [inventory3bhk], links);
    expect(r.bucket).toBe('linked');
    expect(r.propertyId).toBe('p-hsr');
  });

  it('tier 0: matches by normalized listing URL too', () => {
    const links: ExistingPortalLink[] = [
      { property_id: 'p-hsr', portal: 'magicbricks', portal_listing_id: null, listing_url: 'https://www.magicbricks.com/propertyDetails/74829301?src=dash' },
    ];
    const r = matchListing(
      listing({ portalListingId: 'other', listingUrl: 'http://magicbricks.com/propertyDetails/74829301' }),
      [inventory3bhk],
      links
    );
    expect(r.bucket).toBe('linked');
  });

  it('auto-matches a high-confidence unique match instead of creating a duplicate', () => {
    const r = matchListing(listing({}), [inventory3bhk, prop({ id: 'other', location: 'Whitefield', bedrooms: 2, price: 8_000_000 })], []);
    expect(r.bucket).toBe('auto_matched');
    expect(r.propertyId).toBe('p-hsr');
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it('budget-only similarity is NEVER a match (hierarchy rule)', () => {
    const samePriceElsewhere = prop({
      id: 'p-wf',
      title: 'Premium Villa Whitefield',
      type: 'Villa',
      price: 12_500_000,
      location: 'Whitefield',
      city: 'Bengaluru',
      bedrooms: 4,
    });
    const r = matchListing(listing({ propertyType: 'Flat/ Apartment' }), [samePriceElsewhere], []);
    expect(r.bucket).toBe('new');
  });

  it('category mismatch hard-fails the type gate', () => {
    const commercial = prop({ id: 'p-shop', type: 'Commercial Shop', location: 'HSR Layout', city: 'Bengaluru', price: 12_500_000 });
    const s = scoreListingAgainstProperty(listing({}), commercial);
    expect(s.score).toBe(0);
  });

  it('two near-identical inventory rows go to review, not a coin-flip auto-match', () => {
    const twinA = { ...inventory3bhk, id: 'twin-a' };
    const twinB = { ...inventory3bhk, id: 'twin-b', title: 'Luxury 3 BHK Apartment HSR' };
    const r = matchListing(listing({}), [twinA, twinB], []);
    expect(r.bucket).toBe('review');
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('sale listing never matches a rent property', () => {
    const rental = prop({ id: 'p-rent', listing_type: 'Rent', rent_per_month: 45_000, location: 'HSR Layout', city: 'Bengaluru', bedrooms: 3 });
    const r = matchListing(listing({}), [rental], []);
    expect(r.bucket).toBe('new');
  });

  it('same locality + type but very different price lands in review, not auto-match', () => {
    const cheaper = { ...inventory3bhk, id: 'p-cheap', price: 7_000_000 };
    const r = matchListing(listing({}), [cheaper], []);
    expect(r.bucket).not.toBe('auto_matched');
  });
});

describe('groupCrossPortalDuplicates', () => {
  it('groups the same property harvested from two portals into one create', () => {
    const mb = listing({ portal: 'magicbricks', portalListingId: 'mb-1' });
    const acres = listing({ portal: '99acres', portalListingId: 'ac-9', price: 12_600_000 });
    const other = listing({ portal: '99acres', portalListingId: 'ac-10', locality: 'Sarjapur Road', price: 6_000_000 });

    const groups = groupCrossPortalDuplicates([
      { key: 'k1', parsed: mb },
      { key: 'k2', parsed: acres },
      { key: 'k3', parsed: other },
    ]);
    expect(groups.get('k1')).toBe(groups.get('k2'));
    expect(groups.get('k3')).not.toBe(groups.get('k1'));
  });

  it('same portal + same listing id always collapses', () => {
    const a = listing({ portalListingId: 'dup' });
    const b = listing({ portalListingId: 'dup', price: 99_000_000, locality: 'Elsewhere' });
    const groups = groupCrossPortalDuplicates([
      { key: 'k1', parsed: a },
      { key: 'k2', parsed: b },
    ]);
    expect(groups.get('k1')).toBe(groups.get('k2'));
  });

  it('keeps distinct 2 BHK and 3 BHK in the same locality apart', () => {
    const a = listing({ portalListingId: 'a', bedrooms: 2, price: 8_900_000 });
    const b = listing({ portal: '99acres', portalListingId: 'b', bedrooms: 3, price: 8_900_000 });
    const groups = groupCrossPortalDuplicates([
      { key: 'k1', parsed: a },
      { key: 'k2', parsed: b },
    ]);
    expect(groups.get('k1')).not.toBe(groups.get('k2'));
  });
});

describe('thresholds sanity', () => {
  it('review threshold sits below auto-match threshold', () => {
    expect(REVIEW_THRESHOLD).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });
});
