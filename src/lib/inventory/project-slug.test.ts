import { describe, it, expect } from 'vitest';
import { findProjectProperties, slugifyProject } from './project-slug';
import type { Property } from '@/types';

function makeProperty(overrides: Partial<Property>): Property {
  return {
    id: 'p1',
    account_id: 'a1',
    user_id: null,
    title: 'Listing',
    price: 10000000,
    location: 'Bengaluru',
    type: 'Flat/ Apartment',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('slugifyProject', () => {
  it('lowercases and hyphenates project names', () => {
    expect(slugifyProject('SJR Blues')).toBe('sjr-blues');
    expect(slugifyProject('Prestige Lakeside Habitat')).toBe(
      'prestige-lakeside-habitat'
    );
  });

  it('collapses punctuation and extra whitespace', () => {
    expect(slugifyProject('Sobha Dream Acres — Phase 2')).toBe(
      'sobha-dream-acres-phase-2'
    );
    expect(slugifyProject('  Brigade El Dorado.  ')).toBe('brigade-el-dorado');
  });

  it('returns an empty slug for blank input', () => {
    expect(slugifyProject('   ')).toBe('');
  });
});

describe('findProjectProperties', () => {
  const properties = [
    makeProperty({ id: 'p1', project: 'SJR Blues' }),
    makeProperty({ id: 'p2', project: 'SJR Blues.' }),
    makeProperty({ id: 'p3', project: 'SJR Blue Waters' }),
    makeProperty({ id: 'p4', project: null as unknown as undefined }),
    makeProperty({ id: 'p5' }),
  ];

  it('matches listings whose project slugifies to the same slug', () => {
    const result = findProjectProperties(properties, 'sjr-blues');
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('accepts a raw project name as the slug input', () => {
    const result = findProjectProperties(properties, 'SJR Blues');
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('does not match a different project sharing a prefix', () => {
    const result = findProjectProperties(properties, 'sjr-blue-waters');
    expect(result.map((p) => p.id)).toEqual(['p3']);
  });

  it('returns nothing for blank or unknown slugs', () => {
    expect(findProjectProperties(properties, '')).toEqual([]);
    expect(findProjectProperties(properties, 'unknown-project')).toEqual([]);
  });
});
