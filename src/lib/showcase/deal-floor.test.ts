import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import {
  DEAL_FLOOR_BUDGETS,
  dealFloorKindCounts,
  dealFloorKindTypes,
  featuredCover,
  featuredProperty,
  isFlyerImage,
  parentLocality,
  newThisWeek,
  plotFaceDetails,
  quickPickOrder,
  tasteSummary,
  topLocalities,
  withinBudget,
} from './deal-floor';

function property(overrides: Partial<Property>): Property {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    account_id: 'acct-1',
    user_id: null,
    title: 'Listing',
    price: 50_000_000,
    location: 'Koramangala, Bengaluru',
    type: 'Villa',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    images: ['property-images/acct-1/a.jpg'],
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    ...overrides,
  } as Property;
}

describe('deal floor kinds [PRP-020]', () => {
  it('groups raw property types into families and orders by count', () => {
    const kinds = dealFloorKindCounts([
      property({ type: 'Commercial Land' }),
      property({ type: 'Commercial Plot' }),
      property({ type: 'Residential Land/ Plot' }),
      property({ type: 'Residential Plot' }),
      property({ type: 'Residential Land' }),
      property({ type: 'Villa' }),
      property({ type: 'Commercial/ Industrial' }),
      property({ type: 'Commercial/Industrial' }),
      property({ type: 'Others' }),
    ]);
    expect(kinds.map((kind) => [kind.label, kind.count])).toEqual([
      ['Residential plots', 3],
      ['Commercial land', 2],
      ['Industrial', 2],
      ['Houses & villas', 1],
      ['Everything else', 1],
    ]);
    expect(kinds.at(-1)?.types).toEqual(['Others']);
  });

  it('resolves a family key back to the raw types the grid filters on', () => {
    expect(dealFloorKindTypes('kind:flats')).toContain('Flat/ Apartment');
    expect(dealFloorKindTypes('Villa')).toBeNull();
  });
});

describe('deal floor budget [PRP-020]', () => {
  it('keeps sale listings at or under the cap and drops unpriced ones', () => {
    const cap = DEAL_FLOOR_BUDGETS[1].max;
    expect(withinBudget(property({ price: cap }), cap)).toBe(true);
    expect(withinBudget(property({ price: cap + 1 }), cap)).toBe(false);
    expect(withinBudget(property({ price: 0 }), cap)).toBe(false);
    expect(withinBudget(property({ price: 0 }), null)).toBe(true);
  });

  it('compares rentals by monthly rent and never admits gated or JV listings', () => {
    const cap = DEAL_FLOOR_BUDGETS[0].max;
    expect(
      withinBudget(
        property({ listing_type: 'Rent', price: 0, rent_per_month: 150_000 }),
        cap
      )
    ).toBe(true);
    expect(
      withinBudget(property({ teaser_gated: true, price: 1_000 }), cap)
    ).toBe(false);
    expect(
      withinBudget(property({ listing_type: 'JV/JD', price: 1_000 }), cap)
    ).toBe(false);
  });
});

describe('deal floor board', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');

  it('counts listings created in the last seven days', () => {
    expect(
      newThisWeek(
        [
          property({ created_at: '2026-09-25T00:00:00Z' }),
          property({ created_at: '2026-09-19T13:00:00Z' }),
          property({ created_at: '2026-09-01T00:00:00Z' }),
          property({ created_at: 'not a date' }),
        ],
        now
      )
    ).toBe(2);
  });

  it('ranks localities by listing count using the sublocality first', () => {
    expect(
      topLocalities(
        [
          property({
            sublocality: 'HSR Layout',
            location: 'HSR Layout, Bengaluru',
          }),
          property({ sublocality: 'hsr layout', location: 'x' }),
          property({
            sublocality: undefined,
            location: 'Whitefield, Bengaluru',
          }),
          property({ sublocality: undefined, location: '', city: 'Mysuru' }),
        ],
        2
      )
    ).toEqual([
      { name: 'HSR Layout', count: 2 },
      { name: 'Whitefield', count: 1 },
    ]);
  });

  it('folds blocks, sectors and phases into their locality and never lists the city', () => {
    const listings = [
      property({ location: '', sublocality: 'Koramangala', city: 'Bangalore' }),
      property({
        location: '',
        sublocality: 'Koramangala 1st Block',
        city: 'Bangalore',
      }),
      property({
        location: '',
        sublocality: 'Venkatapura, Koramangala 8th Block',
        city: 'Bangalore',
      }),
      property({
        location: '',
        sublocality: 'Koramangala East',
        city: 'Bengaluru',
      }),
      property({
        location: '',
        sublocality: 'HSR Layout 2nd Sector',
        city: 'Bangalore',
      }),
      property({ location: '', sublocality: 'HSR Layout', city: 'Bengaluru' }),
      property({
        sublocality: undefined,
        location: 'Bengaluru',
        city: 'Bengaluru',
      }),
      property({
        sublocality: undefined,
        location: 'Bangalore, Karnataka',
        city: '',
      }),
      property({
        sublocality: undefined,
        location: '1st Sector, HSR',
        city: 'Bangalore',
      }),
    ];
    const ranked = topLocalities(listings, 4);
    expect(ranked).toEqual([
      { name: 'Koramangala', count: 4 },
      { name: 'HSR Layout', count: 2 },
      { name: 'Venkatapura', count: 1 },
    ]);
    expect(ranked.map((entry) => entry.name)).not.toContain('Bangalore');
    expect(parentLocality('JP Nagar 3rd Phase')).toBe('JP Nagar');
    expect(parentLocality('BTM Layout 2nd Stage')).toBe('BTM Layout');
    expect(parentLocality('Electronic City Phase 1')).toBe('Electronic City');
    expect(parentLocality('Whitefield')).toBe('Whitefield');
  });

  it('features a different photographed sale listing each IST day', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.parse('2026-11-10T06:30:00Z');
    const listings = [
      property({ id: 'a', created_at: '2026-11-01T00:00:00Z' }),
      property({ id: 'b', created_at: '2026-11-02T00:00:00Z' }),
      property({ id: 'c', created_at: '2026-11-03T00:00:00Z' }),
      property({ id: 'old', created_at: '2026-01-01T00:00:00Z', price: 9e12 }),
      property({ id: 'no-photo', images: [] }),
      property({ id: 'sold', status: 'Under Contract' }),
      property({ id: 'gated', teaser_gated: true }),
      property({ id: 'rent', listing_type: 'Rent' }),
      property({ id: 'free', price: 0 }),
    ];
    const week = Array.from(
      { length: 3 },
      (_, offset) => featuredProperty(listings, now + offset * day)?.id
    );
    expect(new Set(week)).toEqual(new Set(['a', 'b', 'c']));
    expect(featuredProperty(listings, now)?.id).toBe(
      featuredProperty(listings, now + 60 * 60 * 1000)?.id
    );
    expect(featuredProperty([property({ images: [] })])).toBeNull();
  });

  it('falls back to every eligible listing when few are fresh', () => {
    const now = Date.parse('2026-11-10T06:30:00Z');
    const listings = [
      property({ id: 'new', created_at: '2026-11-05T00:00:00Z' }),
      property({ id: 'old-1', created_at: '2026-03-01T00:00:00Z' }),
      property({ id: 'old-2', created_at: '2026-04-01T00:00:00Z' }),
    ];
    const seen = new Set(
      Array.from(
        { length: 3 },
        (_, offset) =>
          featuredProperty(listings, now + offset * 24 * 60 * 60 * 1000)?.id
      )
    );
    expect(seen).toEqual(new Set(['new', 'old-1', 'old-2']));
  });

  it('never features a generated flyer as the cover photo', () => {
    const flyer = 'property-images/acct-1/flyer-1790404259306-ryacz.png';
    const photo = 'property-images/acct-1/photo.jpg';
    expect(isFlyerImage(flyer)).toBe(true);
    expect(isFlyerImage(photo)).toBe(false);
    expect(featuredCover(property({ images: [flyer, photo] }))).toBe(photo);
    expect(
      featuredProperty([property({ id: 'flyer-only', images: [flyer] })])
    ).toBeNull();
  });
});

describe('quick picks', () => {
  it('deals available listings with photos before photoless ones and skips gated rows', () => {
    const order = quickPickOrder([
      property({ id: 'plot', images: [] }),
      property({ id: 'gated', teaser_gated: true }),
      property({ id: 'sold', status: 'Sold' }),
      property({ id: 'villa' }),
    ]);
    expect(order.map((item) => item.id)).toEqual(['villa', 'plot']);
  });

  it('summarises the taste from shortlisted picks', () => {
    const summary = tasteSummary([
      property({
        type: 'Villa',
        sublocality: 'Kasavanahalli',
        price: 67_900_000,
      }),
      property({
        type: 'Residential House',
        sublocality: 'Yelahanka',
        price: 160_000_000,
      }),
      property({
        type: 'Flat/ Apartment',
        sublocality: 'Koramangala',
        price: 90_000_000,
      }),
    ]);
    expect(summary.headline).toBe('You lean towards houses & villas.');
    expect(summary.chips).toEqual([
      'Houses & villas',
      'Kasavanahalli',
      'under ₹8 Cr',
      'Yelahanka',
      'under ₹25 Cr',
      'Flats',
      'Koramangala',
    ]);
    expect(tasteSummary([]).chips).toEqual([]);
  });
});

describe('plot face', () => {
  it('draws the plot from its dimensions, area, facing and road', () => {
    expect(
      plotFaceDetails(
        property({
          dimensions: '60x40',
          land_area: 2400,
          land_area_unit: 'Sq.Ft.',
          facing_direction: 'East',
          road_width: 40,
          road_width_unit: 'ft',
        })
      )
    ).toEqual({
      headline: '60x40',
      caption: '2,400 Sq.Ft. · East facing',
      road: '40 ft road',
      facing: 'East',
    });
  });

  it('falls back to the area, then the zoning, then a plain label', () => {
    expect(
      plotFaceDetails(property({ land_area: 5, land_area_unit: 'Acre' }))
    ).toMatchObject({ headline: '5 Acre', caption: null, road: null });
    expect(
      plotFaceDetails(property({ land_zone: 'Residential' })).headline
    ).toBe('Residential');
    expect(plotFaceDetails(property({})).headline).toBe('Plot');
  });
});
