import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placesAutocomplete } from './google-places';

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
  delete process.env.GOOGLE_MAPS_API_KEY;
});

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
