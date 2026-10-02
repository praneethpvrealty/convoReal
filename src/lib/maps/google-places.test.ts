import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookups } = vi.hoisted(() => ({
  lookups: [] as Array<[string, string]>,
}));

vi.mock('@/lib/maps/lookup-cache', () => ({
  cachedLookup: async (
    kind: string,
    key: string,
    fetcher: () => Promise<unknown>
  ) => {
    lookups.push([kind, key]);
    return fetcher();
  },
  normalizeLookupKey: (text: string) =>
    text.trim().replace(/\s+/g, ' ').toLowerCase(),
  coordinateLookupKey: (lat: number, lng: number) =>
    `${lat.toFixed(5)},${lng.toFixed(5)}`,
}));

const { geocodeAddress, placesAutocomplete, reverseGeocode } =
  await import('./google-places');

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ suggestions: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  lookups.length = 0;
  delete process.env.GOOGLE_MAPS_API_KEY;
});

function geocodeResponse(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: () => Promise.resolve(body),
  });
}

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe('placesAutocomplete', () => {
  it('sends the dashboard request unchanged when no options are given', async () => {
    await placesAutocomplete('hsr', 'session-1');
    expect(sentBody()).toEqual({
      input: 'hsr',
      sessionToken: 'session-1',
      includedRegionCodes: ['in'],
      languageCode: 'en',
    });
  });

  it('[PRP-013] limits a showcase lookup to areas and biases it toward the inventory', async () => {
    await placesAutocomplete('basavan, Bengaluru', 'session-2', {
      regionsOnly: true,
      bias: { latitude: 12.95, longitude: 77.59, radiusKm: 80 },
    });
    expect(sentBody()).toEqual({
      input: 'basavan, Bengaluru',
      sessionToken: 'session-2',
      includedRegionCodes: ['in'],
      languageCode: 'en',
      includedPrimaryTypes: ['(regions)'],
      locationBias: {
        circle: {
          center: { latitude: 12.95, longitude: 77.59 },
          radius: 50_000,
        },
      },
    });
  });
});

describe('geocodeAddress', () => {
  it('[PRP-025] asks the shared cache under the normalised address before calling Google', async () => {
    geocodeResponse({
      status: 'OK',
      results: [
        {
          place_id: 'p1',
          formatted_address: 'HSR Layout, Bengaluru',
          geometry: { location: { lat: 12.9, lng: 77.6 } },
        },
      ],
    });

    const geo = await geocodeAddress('  HSR   Layout, Bengaluru ');

    expect(lookups).toEqual([['geocode', 'hsr layout, bengaluru']]);
    expect(geo).toEqual({
      latitude: 12.9,
      longitude: 77.6,
      place_id: 'p1',
      formatted_address: 'HSR Layout, Bengaluru',
    });
  });

  it('[PRP-025] resolves ZERO_RESULTS to null so the miss can be cached', async () => {
    geocodeResponse({ status: 'ZERO_RESULTS', results: [] });
    await expect(geocodeAddress('nowhere at all')).resolves.toBeNull();
  });

  it('throws on a quota or transport failure so it is neither cached nor read as a miss', async () => {
    geocodeResponse({ status: 'OVER_QUERY_LIMIT', error_message: 'quota' });
    await expect(geocodeAddress('HSR Layout')).rejects.toThrow('quota');

    geocodeResponse({}, false);
    await expect(geocodeAddress('HSR Layout')).rejects.toThrow('503');
  });
});

describe('reverseGeocode', () => {
  it('[PRP-025] keys the cache by the pin rounded to about a metre', async () => {
    geocodeResponse({
      status: 'OK',
      results: [
        {
          place_id: 'p2',
          formatted_address: 'HSR Layout, Bengaluru, Karnataka, India',
          types: ['sublocality'],
          address_components: [
            { long_name: 'HSR Layout', types: ['sublocality_level_1'] },
            { long_name: 'Bengaluru', types: ['locality'] },
            { long_name: 'Karnataka', types: ['administrative_area_level_1'] },
          ],
        },
      ],
    });

    const place = await reverseGeocode(12.912345678, 77.644599999);

    expect(lookups).toEqual([['reverse-geocode', '12.91235,77.64460']]);
    expect(place).toMatchObject({
      sublocality: 'HSR Layout',
      city: 'Bengaluru',
      state: 'Karnataka',
    });
  });

  it('resolves ZERO_RESULTS to null and throws on any other failure', async () => {
    geocodeResponse({ status: 'ZERO_RESULTS', results: [] });
    await expect(reverseGeocode(0, 0)).resolves.toBeNull();

    geocodeResponse({ status: 'REQUEST_DENIED', error_message: 'bad key' });
    await expect(reverseGeocode(0, 0)).rejects.toThrow('bad key');
  });
});
