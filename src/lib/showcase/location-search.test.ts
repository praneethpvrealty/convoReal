import { describe, expect, it } from 'vitest';

import type { Property } from '@/types';
import {
  locationCandidates,
  matchesSelectedLocation,
} from './location-search';

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
      'Indiranagar, Bengaluru',
      'Koramangala',
      'Koramangala, Bengaluru',
      'Whitefield',
      'Whitefield, Bengaluru',
    ]);
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
