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
