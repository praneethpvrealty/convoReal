import { describe, expect, it } from 'vitest';
import {
  curateForBuyer,
  hasBuyerBrief,
  matchReasons,
  mergeCuratedFeeds,
  MIN_BUYER_MATCH_SCORE,
} from './matches-ranking';
import type { Contact, Property } from '@/types';

function property(overrides: Partial<Property>): Property {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'acc',
    user_id: null,
    title: 'Listing',
    price: 10_000_000,
    location: 'Bangalore',
    city: 'Bangalore',
    type: 'Flat/Apartment',
    status: 'Available',
    listing_type: 'Sale',
    ...overrides,
  } as Property;
}

function buyer(overrides: Partial<Contact>): Contact {
  return {
    id: 'c1',
    name: 'Ravi',
    phone: '9845012345',
    classification: 'Buyer',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Contact;
}

describe('curateForBuyer', () => {
  const contact = buyer({
    min_budget: 8_000_000,
    max_budget: 12_000_000,
    areas_of_interest: ['Whitefield'],
    property_interests: ['Flat/Apartment'],
  });

  it('surfaces a listing that fits the brief', () => {
    const fits = property({
      id: 'fits',
      sublocality: 'Whitefield',
      price: 9_500_000,
      bedrooms: 3,
    });
    const matches = curateForBuyer([fits], contact);
    expect(matches).toHaveLength(1);
    expect(matches[0].property.id).toBe('fits');
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_BUYER_MATCH_SCORE);
    expect(matches[0].reasons.length).toBeGreaterThan(0);
  });

  it('drops listings that score below the floor', () => {
    const wrong = property({
      id: 'wrong',
      type: 'Agricultural Land',
      location: 'Mysore',
      city: 'Mysore',
      sublocality: 'Nanjangud',
      price: 900_000_000,
    });
    expect(curateForBuyer([wrong], contact)).toHaveLength(0);
  });

  it('ranks by score, then by price ascending', () => {
    const pool = [
      property({ id: 'pricey', sublocality: 'Whitefield', price: 11_500_000 }),
      property({ id: 'cheaper', sublocality: 'Whitefield', price: 8_500_000 }),
    ];
    const ids = curateForBuyer(pool, contact).map((m) => m.property.id);
    expect(ids[0]).toBe('cheaper');
  });

  it('honours the limit', () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      property({ id: `p${i}`, sublocality: 'Whitefield', price: 9_000_000 + i })
    );
    expect(curateForBuyer(pool, contact, { limit: 3 })).toHaveLength(3);
  });

  it('returns nothing for an empty pool rather than throwing', () => {
    expect(curateForBuyer([], contact)).toEqual([]);
  });
});

describe('mergeCuratedFeeds', () => {
  it('de-duplicates a listing carried by two agencies, keeping the better score', () => {
    const shared = property({ id: 'shared' });
    const merged = mergeCuratedFeeds(
      [
        [{ property: shared, score: 70, details: {} as never, reasons: [] }],
        [{ property: shared, score: 88, details: {} as never, reasons: [] }],
      ],
      10
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(88);
  });

  it('orders the combined feed by score and caps it', () => {
    const merged = mergeCuratedFeeds(
      [
        [
          {
            property: property({ id: 'a' }),
            score: 65,
            details: {} as never,
            reasons: [],
          },
        ],
        [
          {
            property: property({ id: 'b' }),
            score: 90,
            details: {} as never,
            reasons: [],
          },
        ],
        [
          {
            property: property({ id: 'c' }),
            score: 80,
            details: {} as never,
            reasons: [],
          },
        ],
      ],
      2
    );
    expect(merged.map((m) => m.property.id)).toEqual(['b', 'c']);
  });
});

describe('matchReasons', () => {
  it('says why in the buyer’s terms, not the engine’s', () => {
    const reasons = matchReasons({
      type: 'match',
      location: 'partial',
      budget: 'match',
      bhk: 'match',
      roi: 'unknown',
    } as never);
    expect(reasons).toEqual([
      'Type you asked for',
      'Same city',
      'Within budget',
      'BHK fits',
    ]);
  });

  it('leads with the named project when the buyer asked for one', () => {
    const reasons = matchReasons({
      type: 'match',
      location: 'match',
      budget: 'match',
      bhk: 'unknown',
      roi: 'unknown',
      project: 'match',
    } as never);
    expect(reasons[0]).toBe('Project you asked for');
  });

  it('drops the locality line on a project match, which the engine never checked', () => {
    const reasons = matchReasons({
      type: 'match',
      location: 'match',
      budget: 'unknown',
      bhk: 'unknown',
      roi: 'unknown',
      project: 'match',
    } as never);
    expect(reasons).not.toContain('In your area');
  });
});

describe('hasBuyerBrief', () => {
  it('recognises any real preference signal', () => {
    expect(hasBuyerBrief(buyer({ max_budget: 12_000_000 }))).toBe(true);
    expect(hasBuyerBrief(buyer({ areas_of_interest: ['Whitefield'] }))).toBe(
      true
    );
    expect(hasBuyerBrief(buyer({ property_interests: ['Villa'] }))).toBe(true);
    expect(hasBuyerBrief(buyer({ min_roi: 6 }))).toBe(true);
    expect(hasBuyerBrief(buyer({ requirements: 'corner plot' }))).toBe(true);
    expect(
      hasBuyerBrief(buyer({ projects_of_interest: ['Purva Westend'] }))
    ).toBe(true);
    expect(
      hasBuyerBrief(
        buyer({
          requirement_profiles: [
            {
              id: 'brief',
              title: 'Dabaspete warehouse land',
              raw_text: '2–3 acres near STRR',
              source: 'manual',
              active: true,
              property_types: ['Industrial Land'],
              property_categories: ['industrial'],
              bhk_min: null,
              bhk_max: null,
              budget_min: null,
              budget_max: null,
              land_area_min_sqft: 87_120,
              land_area_max_sqft: 130_680,
              areas: ['Dabaspete'],
              excluded_areas: [],
              projects: [],
              min_roi: null,
              listing_types: [],
              created_at: '2026-08-18T00:00:00Z',
              updated_at: '2026-08-18T00:00:00Z',
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('rejects a contact with nothing on file, so nothing buyer-facing runs on noise', () => {
    expect(hasBuyerBrief(buyer({}))).toBe(false);
    expect(
      hasBuyerBrief(buyer({ requirements: '   ', areas_of_interest: [] }))
    ).toBe(false);
  });
});
