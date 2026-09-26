import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import {
  DEAL_FLOOR_BUDGETS,
  dealFloorKindCounts,
  dealFloorKindTypes,
  featuredProperty,
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
      { name: 'Mysuru', count: 1 },
    ]);
  });

  it('features the priciest available photographed sale listing', () => {
    const pricey = property({ id: 'pricey', price: 650_000_000 });
    expect(
      featuredProperty([
        property({ price: 900_000_000, images: [] }),
        property({ price: 800_000_000, status: 'Under Contract' }),
        property({ price: 700_000_000, teaser_gated: true }),
        pricey,
        property({ price: 100 }),
      ])?.id
    ).toBe('pricey');
    expect(featuredProperty([property({ images: [] })])).toBeNull();
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
