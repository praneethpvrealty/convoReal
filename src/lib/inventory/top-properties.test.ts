import { describe, expect, it } from 'vitest';
import type { Contact, Property } from '@/types';
import { rankInventoryProperties } from './top-properties';

function property(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    account_id: 'account-1',
    user_id: 'user-1',
    title: id,
    description: '',
    price: 10_000_000,
    location: 'Bengaluru',
    type: 'Commercial Land',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    user_id: 'user-1',
    phone: '+919999999999',
    name: 'Gowrishankar',
    classification: 'Buyer',
    requirement_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rankInventoryProperties', () => {
  it('puts a strong contact match before a newer unrelated listing', () => {
    const unrelated = property('new-whitefield', {
      sublocality: 'Whitefield',
      updated_at: '2026-09-05T00:00:00.000Z',
    });
    const matching = property('hbr-match', {
      sublocality: 'HBR Layout',
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    const ranked = rankInventoryProperties(
      [unrelated, matching],
      contact({
        property_interests: ['Commercial Land'],
        areas_of_interest: ['HBR Layout'],
        min_budget: 8_000_000,
        max_budget: 15_000_000,
      })
    );

    expect(ranked.properties.map((item) => item.id)).toEqual([
      'hbr-match',
      'new-whitefield',
    ]);
    expect(ranked.matchCount).toBe(1);
    expect(ranked.personalized).toBe(true);
  });

  it('uses the account star before completeness for a generic update', () => {
    const complete = property('complete', {
      sublocality: 'HSR Layout',
      land_area: 2400,
      property_code: 'PROP-1',
      images: ['front.jpg'],
      description: 'Corner plot',
    });
    const starred = property('starred', { is_starred: true });

    expect(
      rankInventoryProperties([complete, starred]).properties.map(
        (item) => item.id
      )
    ).toEqual(['starred', 'complete']);
  });

  it('uses listing readiness and freshness when there is no buyer brief', () => {
    const sparseNew = property('sparse-new', {
      updated_at: '2026-09-05T00:00:00.000Z',
    });
    const completeOld = property('complete-old', {
      sublocality: 'Koramangala',
      land_area: 3300,
      property_code: 'PROP-2',
      images: ['front.jpg'],
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const ranked = rankInventoryProperties([sparseNew, completeOld], contact());

    expect(ranked.properties[0].id).toBe('complete-old');
    expect(ranked.personalized).toBe(false);
  });

  it('honors an explicit hand-picked sequence', () => {
    const first = property('first');
    const second = property('second', { is_starred: true });
    expect(
      rankInventoryProperties([first, second], null, {
        preserveOrder: true,
      }).properties.map((item) => item.id)
    ).toEqual(['first', 'second']);
  });
});

describe('[PRP-065] rankInventoryProperties with a brief nothing matches', () => {
  const brief = contact({
    pref_property_categories: ['commercial'],
    pref_budget_min: 100_000_000,
    pref_budget_max: 150_000_000,
    pref_areas: ['Indiranagar'],
    strict_area_match: true,
  });
  const stock = [
    property('it-park', {
      type: 'Commercial Building',
      price: 3_800_000_000,
      location: 'Domlur',
      is_starred: true,
    }),
    property('flat', {
      type: 'Flat/ Apartment',
      price: 120_000_000,
      location: 'Whitefield',
      is_starred: true,
    }),
    property('building', {
      type: 'Commercial Building',
      price: 200_000_000,
      location: 'Kundalahalli',
    }),
  ];

  it('puts the wanted category first and the nearest price ahead of a starred outlier', () => {
    const ranking = rankInventoryProperties(stock, brief);
    expect(ranking.matchCount).toBe(0);
    expect(ranking.closestFirst).toBe(true);
    expect(ranking.briefCategories).toEqual(['Commercial']);
    expect(ranking.properties.map((p) => p.id)).toEqual([
      'building',
      'it-park',
      'flat',
    ]);
  });

  it('counts the categories of every active brief, not only the first', () => {
    const ranking = rankInventoryProperties(
      stock,
      contact({
        requirements: 'Flat in Indiranagar',
        pref_property_categories: ['residential'],
        pref_areas: ['Indiranagar'],
        strict_area_match: true,
        requirement_profiles: [
          {
            id: 'p2',
            title: 'Commercial',
            raw_text: 'Commercial building in Indiranagar',
            source: 'manual',
            active: true,
            property_types: [],
            property_categories: ['commercial'],
            bhk_min: null,
            bhk_max: null,
            budget_min: null,
            budget_max: null,
            land_area_min_sqft: null,
            land_area_max_sqft: null,
            areas: ['Indiranagar'],
            excluded_areas: [],
            projects: [],
            min_roi: null,
          },
        ] as unknown as Contact['requirement_profiles'],
      })
    );
    expect([...ranking.briefCategories].sort()).toEqual([
      'Commercial',
      'Residential',
    ]);
  });

  it('names no category when one brief leaves it open', () => {
    const ranking = rankInventoryProperties(
      stock,
      contact({
        requirements: 'Anything in Indiranagar under 15 Cr',
        pref_budget_max: 150_000_000,
        pref_areas: ['Indiranagar'],
        strict_area_match: true,
        requirement_profiles: [
          {
            id: 'p2',
            raw_text: 'Commercial building in Indiranagar',
            active: true,
            property_types: [],
            property_categories: ['commercial'],
            budget_min: null,
            budget_max: 150_000_000,
            areas: ['Indiranagar'],
          },
        ] as unknown as Contact['requirement_profiles'],
      })
    );
    expect(ranking.briefCategories).toEqual([]);
  });

  it('never ranks a rental as close to a purchase budget', () => {
    const ranking = rankInventoryProperties(
      [
        property('rental', {
          type: 'Commercial Building',
          listing_type: 'Rent',
          rent_per_month: 600_000,
          price: 0,
          location: 'Domlur',
          is_starred: true,
        }),
        property('sale', {
          type: 'Commercial Building',
          price: 160_000_000,
          location: 'Kundalahalli',
        }),
      ],
      brief
    );
    expect(ranking.properties.map((p) => p.id)).toEqual(['sale', 'rental']);
  });

  it('measures a rental against a monthly rent budget', () => {
    const renter = contact({
      pref_property_categories: ['commercial'],
      pref_budget_max: 200_000,
      pref_areas: ['Indiranagar'],
      strict_area_match: true,
    });
    const rent = (id: string, amount: number, starred = false) =>
      property(id, {
        type: 'Commercial Office Space',
        listing_type: 'Rent',
        rent_per_month: amount,
        price: 0,
        location: 'Domlur',
        is_starred: starred,
      });
    const ranking = rankInventoryProperties(
      [rent('far', 900_000, true), rent('near', 220_000)],
      renter
    );
    expect(ranking.properties.map((p) => p.id)).toEqual(['near', 'far']);
  });

  it('keeps the old order when the brief states no category or budget', () => {
    const ranking = rankInventoryProperties(
      stock,
      contact({ pref_areas: ['Indiranagar'], strict_area_match: true })
    );
    expect(ranking.closestFirst).toBe(false);
    expect(ranking.properties[0].is_starred).toBe(true);
  });
});
