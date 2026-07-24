import { describe, it, expect } from 'vitest';
import {
  FARMLAND_DESTINATIONS,
  getFarmlandDestination,
  matchesFarmlandDestination,
} from './farmland-destinations';
import type { Property } from '@/types';

function makeProperty(overrides: Partial<Property>): Property {
  return {
    id: 'p1',
    account_id: 'a1',
    user_id: null,
    title: 'Listing',
    price: 10000000,
    location: '',
    type: 'Agricultural Land',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getFarmlandDestination', () => {
  it('resolves known slugs case-insensitively', () => {
    expect(getFarmlandDestination('coorg')?.name).toBe('Coorg');
    expect(getFarmlandDestination('OOTY')?.name).toBe('Ooty');
    expect(getFarmlandDestination(' Sakleshpur ')?.name).toBe('Sakleshpur');
  });

  it('returns null for unknown slugs', () => {
    expect(getFarmlandDestination('goa')).toBeNull();
    expect(getFarmlandDestination('')).toBeNull();
  });

  it('every destination has a valid showcase theme and search terms', () => {
    const validThemes = ['violet', 'emerald', 'cobalt', 'amber', 'rose'];
    FARMLAND_DESTINATIONS.forEach((d) => {
      expect(validThemes).toContain(d.theme);
      expect(d.searchTerms.length).toBeGreaterThan(0);
      expect(d.searchTerms).toContain(d.slug);
    });
  });
});

describe('matchesFarmlandDestination', () => {
  const coorg = getFarmlandDestination('coorg')!;

  it('matches agricultural land located in the destination', () => {
    const property = makeProperty({ location: 'Madikeri', city: 'Coorg' });
    expect(matchesFarmlandDestination(property, coorg)).toBe(true);
  });

  it('matches on taluk-level search terms', () => {
    const property = makeProperty({
      location: 'Near Kushalnagar town',
      city: 'Kodagu',
    });
    expect(matchesFarmlandDestination(property, coorg)).toBe(true);
  });

  it('matches farm houses as well as agricultural land', () => {
    const property = makeProperty({
      type: 'Farm House',
      title: 'Coffee estate farm house in Virajpet',
    });
    expect(matchesFarmlandDestination(property, coorg)).toBe(true);
  });

  it('rejects non-agricultural types even in the destination', () => {
    const property = makeProperty({ type: 'Villa', city: 'Madikeri' });
    expect(matchesFarmlandDestination(property, coorg)).toBe(false);
  });

  it('rejects agricultural land outside the destination', () => {
    const property = makeProperty({
      location: 'Kanakapura Road',
      city: 'Bengaluru',
    });
    expect(matchesFarmlandDestination(property, coorg)).toBe(false);
  });

  it('keeps destinations disjoint for their own slugs', () => {
    const ooty = getFarmlandDestination('ooty')!;
    const property = makeProperty({ city: 'Coonoor', state: 'Tamil Nadu' });
    expect(matchesFarmlandDestination(property, ooty)).toBe(true);
    expect(matchesFarmlandDestination(property, coorg)).toBe(false);
  });
});
