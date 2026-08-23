import { beforeEach, describe, expect, it } from 'vitest';

import { usePropertySearch } from './property-search-store';

beforeEach(() => {
  usePropertySearch.setState({ near: null, locations: [] });
});

describe('property location filters', () => {
  it('adds distinct localities and removes them individually', () => {
    const state = usePropertySearch.getState();
    state.addLocation('Whitefield');
    state.addLocation('Koramangala');
    state.addLocation(' whitefield ');

    expect(usePropertySearch.getState().locations).toEqual([
      'Whitefield',
      'Koramangala',
    ]);

    usePropertySearch.getState().removeLocation('Whitefield');
    expect(usePropertySearch.getState().locations).toEqual(['Koramangala']);
  });

  it('keeps radius and multi-location searches mutually exclusive', () => {
    usePropertySearch.getState().addLocation('Whitefield');
    usePropertySearch.getState().setNear({
      label: 'Koramangala',
      latitude: 12.9352,
      longitude: 77.6245,
      place_id: 'place-1',
      radiusKm: 5,
    });

    expect(usePropertySearch.getState().locations).toEqual([]);

    usePropertySearch.getState().addLocation('Indiranagar');
    expect(usePropertySearch.getState().near).toBeNull();
  });
});
