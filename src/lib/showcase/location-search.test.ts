import { describe, expect, it } from 'vitest';

import type { Property } from '@/types';
import { locationCandidates, matchesSelectedLocation } from './location-search';

const properties = [
  {
    id: 'koramangala',
    location: 'Koramangala, Bengaluru',
    sublocality: 'Koramangala',
    city: 'Bengaluru',
  },
  {
    id: 'indiranagar',
    location: 'Indiranagar, Bengaluru',
    sublocality: 'Indiranagar',
    city: 'Bengaluru',
  },
  {
    id: 'whitefield',
    location: 'Whitefield, Bengaluru',
    sublocality: 'Whitefield',
    city: 'Bengaluru',
  },
] as unknown as Property[];

describe('showcase location search', () => {
  it('offers unique locations from the published catalog', () => {
    expect(locationCandidates(properties)).toEqual([
      'Bengaluru',
      'Indiranagar',
      'Koramangala',
      'Whitefield',
    ]);
  });

  it('folds "<place>, <city>" into the bare place, including the Bangalore spelling', () => {
    const catalog = [
      { id: 'a', location: '6th block, F Sector', city: 'Bengaluru' },
      { id: 'b', location: '6th block, F Sector, Bangalore', city: null },
      { id: 'c', location: 'Aavalahalli', city: 'Bengaluru' },
      { id: 'd', location: 'Aavalahalli, Bandapura', city: 'Bengaluru' },
      { id: 'e', location: 'HSR Layout, Bengaluru', city: 'Bengaluru' },
    ] as unknown as Property[];

    expect(locationCandidates(catalog)).toEqual([
      '6th block, F Sector',
      'Aavalahalli',
      'Aavalahalli, Bandapura',
      'Bengaluru',
      'HSR Layout, Bengaluru',
    ]);
    expect(matchesSelectedLocation(catalog[1], ['6th block, F Sector'])).toBe(
      true
    );
  });

  it('uses OR logic for selected location chips', () => {
    expect(
      matchesSelectedLocation(properties[0], ['Koramangala', 'Indiranagar'])
    ).toBe(true);
    expect(
      matchesSelectedLocation(properties[1], ['Koramangala', 'Indiranagar'])
    ).toBe(true);
    expect(
      matchesSelectedLocation(properties[2], ['Koramangala', 'Indiranagar'])
    ).toBe(false);
  });
});
