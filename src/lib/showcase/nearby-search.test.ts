import { describe, expect, it } from 'vitest';
import {
  dominantCity,
  geocodeQuery,
  publicDistanceKm,
  rankNearbyListings,
  type NearbyCandidate,
} from './nearby-search';

const basavanagudi = { latitude: 12.9416, longitude: 77.5738 };

function row(
  overrides: Partial<NearbyCandidate> & { id: string }
): NearbyCandidate {
  return {
    latitude: null,
    longitude: null,
    city: 'Bengaluru',
    sublocality: null,
    location: null,
    title: null,
    ...overrides,
  };
}

describe('showcase nearby search', () => {
  it('[PRP-013] ranks named-area listings first, then others within the radius by distance', () => {
    const rows = [
      row({
        id: 'far',
        latitude: 13.1,
        longitude: 77.7,
        sublocality: 'Yelahanka',
      }),
      row({
        id: 'jayanagar',
        latitude: 12.9299,
        longitude: 77.5826,
        sublocality: 'Jayanagar',
      }),
      row({
        id: 'southend',
        latitude: 12.9401,
        longitude: 77.5781,
        sublocality: 'Southend Road',
      }),
      row({ id: 'named', sublocality: 'Basavanagudi' }),
    ];

    expect(
      rankNearbyListings(rows, basavanagudi, ['Basavanagudi', 'basavan'])
    ).toEqual([
      { id: 'named', tier: 'exact', distance_km: null },
      { id: 'southend', tier: 'nearby', distance_km: 0.5 },
      { id: 'jayanagar', tier: 'nearby', distance_km: 1.5 },
    ]);
  });

  it('[PRP-013] still returns named-area listings when the place could not be geocoded', () => {
    const rows = [
      row({
        id: 'named',
        latitude: 12.94,
        longitude: 77.57,
        title: 'Plot in Basavanagudi',
      }),
      row({
        id: 'other',
        latitude: 12.94,
        longitude: 77.57,
        sublocality: 'Jayanagar',
      }),
    ];

    expect(rankNearbyListings(rows, null, ['Basavanagudi'])).toEqual([
      { id: 'named', tier: 'exact', distance_km: null },
    ]);
  });

  it('coarsens distances to half a kilometre so a public search never pins a listing', () => {
    expect(publicDistanceKm(0.04)).toBe(0.5);
    expect(publicDistanceKm(1.26)).toBe(1.5);
    expect(publicDistanceKm(3.1)).toBe(3);
  });

  it('geocodes a bare area name inside the city most of the inventory is in', () => {
    const city = dominantCity([
      { city: 'Bengaluru' },
      { city: 'Mysuru' },
      { city: 'bengaluru' },
      { city: null },
    ]);
    expect(city).toBe('Bengaluru');
    expect(geocodeQuery('basavan', city)).toBe('basavan, Bengaluru');
    expect(geocodeQuery('Basavanagudi, Bengaluru', city)).toBe(
      'Basavanagudi, Bengaluru'
    );
    expect(geocodeQuery('basavan', null)).toBe('basavan');
  });
});
