import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractCoordinatesFromMapUrl,
  extractPlaceNameFromMapUrl,
  googleMapsUrlForCoordinates,
  parseCoordinatePair,
  resolveCoordinatesFromMapLink,
  resolveLocationFromCoordinates,
  resolveLocationFromGoogleMapLink,
  resolveMapPin,
} from '@/lib/maps/resolve-location';

describe('parseCoordinatePair', () => {
  it('reads a WhatsApp pin sent as bare text', () => {
    expect(parseCoordinatePair('12.8669,77.5565483')).toEqual({
      latitude: 12.8669,
      longitude: 77.5565483,
    });
    expect(parseCoordinatePair(' 12.8669 , 77.5565 ')).toEqual({
      latitude: 12.8669,
      longitude: 77.5565,
    });
  });

  it('rejects integer pairs that are really dimensions or counts', () => {
    expect(parseCoordinatePair('30, 77')).toBeNull();
    expect(parseCoordinatePair('30x77')).toBeNull();
  });

  it('rejects out-of-range, null-island and non-coordinate text', () => {
    expect(parseCoordinatePair('112.5,77.5')).toBeNull();
    expect(parseCoordinatePair('12.5,277.5')).toBeNull();
    expect(parseCoordinatePair('0.0,0.0')).toBeNull();
    expect(parseCoordinatePair('Jayanagar, Bengaluru')).toBeNull();
    expect(parseCoordinatePair(null)).toBeNull();
  });
});

describe('extractCoordinatesFromMapUrl', () => {
  const cases: [string, string][] = [
    [
      'pin-share search URL',
      'https://www.google.com/maps/search/?api=1&query=12.8669,77.5565483',
    ],
    ['q parameter', 'https://maps.google.com/?q=12.8669,77.5565483'],
    ['ll parameter', 'https://maps.google.com/maps?ll=12.8669,77.5565483&z=17'],
    [
      'encoded query',
      'https://www.google.com/maps/search/?api=1&query=12.8669%2C77.5565483',
    ],
    ['viewport form', 'https://www.google.com/maps/@12.8669,77.5565483,17z'],
    [
      'place detail form',
      'https://www.google.com/maps/place/Some+Layout/data=!4m6!3m5!1s0x0!3d12.8669!4d77.5565483',
    ],
    ['path pair', 'https://www.google.com/maps/search/12.8669,+77.5565483/'],
  ];

  it.each(cases)('extracts coordinates from the %s', (_label, url) => {
    expect(extractCoordinatesFromMapUrl(url)).toEqual({
      latitude: 12.8669,
      longitude: 77.5565483,
    });
  });

  it('returns null for a short link that carries nothing', () => {
    expect(
      extractCoordinatesFromMapUrl('https://maps.app.goo.gl/ZoCRFNyHvhL3aXhi9')
    ).toBeNull();
  });
});

describe('extractPlaceNameFromMapUrl', () => {
  it('reads the embedded place name', () => {
    expect(
      extractPlaceNameFromMapUrl(
        'https://www.google.com/maps/place/Jayanagar,+Bengaluru,+Karnataka/@12.925,77.593,15z'
      )
    ).toBe('Jayanagar, Bengaluru, Karnataka');
  });

  it('reads the textual address from a Maps q parameter', () => {
    expect(
      extractPlaceNameFromMapUrl(
        'https://maps.google.com?q=NH+48,+Chennapalli,+Tamil+Nadu+635117,+India'
      )
    ).toBe('NH 48, Chennapalli, Tamil Nadu 635117, India');
  });

  it('ignores coordinate pairs and plus codes posing as place names', () => {
    expect(
      extractPlaceNameFromMapUrl(
        'https://www.google.com/maps/place/12.8669,77.5565483/@12.8,77.5,15z'
      )
    ).toBeNull();
    expect(
      extractPlaceNameFromMapUrl(
        'https://www.google.com/maps/place/7J4W%2BX8+Bengaluru/@12.8,77.5,15z'
      )
    ).toBeNull();
  });
});

describe('googleMapsUrlForCoordinates', () => {
  it('builds the canonical pin URL', () => {
    expect(googleMapsUrlForCoordinates(12.8669, 77.5565483)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.8669,77.5565483'
    );
  });
});

describe('reverse geocoding', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  function jsonResponse(body: unknown, url = '') {
    return { ok: true, url, json: async () => body } as unknown as Response;
  }

  it('prefers Google and composes "sublocality, city"', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'OK',
        results: [
          {
            place_id: 'plus-code',
            types: ['plus_code'],
            formatted_address: '7J4W+X8 Bengaluru, Karnataka, India',
            address_components: [],
          },
          {
            place_id: 'abc',
            types: ['street_address'],
            formatted_address:
              '1st Cross Rd, Anjanapura, Bengaluru, Karnataka 560062, India',
            address_components: [
              {
                long_name: 'Anjanapura',
                types: ['sublocality_level_1', 'sublocality'],
              },
              { long_name: 'Bengaluru', types: ['locality'] },
              {
                long_name: 'Karnataka',
                types: ['administrative_area_level_1'],
              },
            ],
          },
        ],
      })
    );

    const result = await resolveLocationFromCoordinates(12.8669, 77.5565483);

    expect(result).toEqual({
      location: 'Anjanapura, Bengaluru',
      sublocality: 'Anjanapura',
      city: 'Bengaluru',
      state: 'Karnataka',
      latitude: 12.8669,
      longitude: 77.5565483,
    });
    expect(fetchMock.mock.calls[0][0]).toContain('latlng=12.8669%2C77.5565483');
  });

  it('falls back to Nominatim when no Google key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        display_name: 'Anjanapura, Bengaluru South, Karnataka, 560062, India',
        address: {
          suburb: 'Anjanapura',
          city: 'Bengaluru',
          state: 'Karnataka',
        },
      })
    );

    const result = await resolveLocationFromCoordinates(12.8669, 77.5565483);

    expect(result?.location).toBe('Anjanapura, Bengaluru');
    expect(result?.state).toBe('Karnataka');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'nominatim.openstreetmap.org'
    );
  });

  it('returns null instead of throwing when the geocoder fails', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await resolveLocationFromCoordinates(12.8669, 77.5565483)
    ).toBeNull();
  });
});

describe('resolveLocationFromGoogleMapLink', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('resolves a pin-share URL without following any redirect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: '',
      json: async () => ({
        display_name: 'Anjanapura, Bengaluru, Karnataka, India',
        address: {
          suburb: 'Anjanapura',
          city: 'Bengaluru',
          state: 'Karnataka',
        },
      }),
    } as unknown as Response);

    const result = await resolveLocationFromGoogleMapLink(
      'https://www.google.com/maps/search/?api=1&query=12.8669,77.5565483'
    );

    expect(result).toMatchObject({
      location: 'Anjanapura, Bengaluru',
      latitude: 12.8669,
      longitude: 77.5565483,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'nominatim.openstreetmap.org'
    );
  });

  it('follows a short link and reverse-geocodes the coordinates behind it', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/place/Anjanapura+Township/@12.8669,77.5565483,17z',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        url: '',
        json: async () => ({
          display_name: 'Anjanapura, Bengaluru, Karnataka, India',
          address: {
            suburb: 'Anjanapura',
            city: 'Bengaluru',
            state: 'Karnataka',
          },
        }),
      } as unknown as Response);

    const result = await resolveLocationFromGoogleMapLink(
      'https://maps.app.goo.gl/ZoCRFNyHvhL3aXhi9'
    );

    expect(result).toMatchObject({
      location: 'Anjanapura Township, Bengaluru',
      sublocality: 'Anjanapura',
      city: 'Bengaluru',
      latitude: 12.8669,
      longitude: 77.5565483,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('geocodes a textual address behind a short link before resolving its location parts', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://maps.google.com?q=NH+48,+Chennapalli,+Tamil+Nadu+635117,+India',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        url: '',
        json: async () => ({
          status: 'OK',
          results: [
            {
              place_id: 'chennapalli',
              formatted_address: 'NH 48, Chennapalli, Tamil Nadu 635117, India',
              geometry: { location: { lat: 12.641, lng: 78.01 } },
            },
          ],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        url: '',
        json: async () => ({
          status: 'OK',
          results: [
            {
              place_id: 'chennapalli',
              formatted_address: 'NH 48, Chennapalli, Tamil Nadu 635117, India',
              address_components: [
                { long_name: 'Chennapalli', types: ['locality'] },
                {
                  long_name: 'Tamil Nadu',
                  types: ['administrative_area_level_1'],
                },
              ],
            },
          ],
        }),
      } as unknown as Response);

    const result = await resolveLocationFromGoogleMapLink(
      'https://maps.app.goo.gl/Fhx2tTxkgThQziZQ9'
    );

    expect(result).toMatchObject({
      location: 'NH 48, Chennapalli, Tamil Nadu 635117, India',
      city: 'Chennapalli',
      state: 'Tamil Nadu',
      latitude: 12.641,
      longitude: 78.01,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to the embedded place name when geocoding yields nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      url: '',
      json: async () => ({}),
    } as unknown as Response);

    const result = await resolveLocationFromGoogleMapLink(
      'https://www.google.com/maps/place/Prestige+Falcon+City/@12.8669,77.5565483,17z'
    );

    expect(result).toEqual({
      location: 'Prestige Falcon City',
      sublocality: null,
      city: null,
      state: null,
      latitude: 12.8669,
      longitude: 77.5565483,
    });
  });

  it('returns null when the link carries nothing usable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://www.google.com/maps',
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveLocationFromGoogleMapLink('https://maps.app.goo.gl/dead')
    ).toBeNull();
  });
});

describe('resolveCoordinatesFromMapLink', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('reads inline coordinates without any network call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(
      await resolveCoordinatesFromMapLink(
        'https://www.google.com/maps?q=12.937435,77.617888'
      )
    ).toEqual({ latitude: 12.937435, longitude: 77.617888 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a short link to the coordinates behind it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://www.google.com/maps/place/Some+Site/@12.937435,77.617888,17z',
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveCoordinatesFromMapLink('https://maps.app.goo.gl/abc')
    ).toEqual({
      latitude: 12.937435,
      longitude: 77.617888,
    });
  });

  it('[PRP-018] returns null for a link that names a place when no Maps key is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    expect(
      await resolveCoordinatesFromMapLink(
        'https://www.google.com/maps/search/?api=1&query=Koramangala+Bengaluru'
      )
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[PRP-018] geocodes the place a short link names when it carries no coordinates', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/place/Prestige+Lakeside+Habitat,+Varthur,+Bengaluru',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [
            {
              place_id: 'plh',
              formatted_address:
                'Prestige Lakeside Habitat, Varthur, Bengaluru',
              geometry: { location: { lat: 12.9416, lng: 77.7466 } },
            },
          ],
        }),
      } as unknown as Response);

    expect(
      await resolveCoordinatesFromMapLink('https://maps.app.goo.gl/place')
    ).toEqual({
      latitude: 12.9416,
      longitude: 77.7466,
    });
    const geocodeUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(geocodeUrl.pathname).toBe('/maps/api/geocode/json');
    expect(geocodeUrl.searchParams.get('address')).toBe(
      'Prestige Lakeside Habitat, Varthur, Bengaluru'
    );
  });

  it('[PRP-018] geocodes a ?q= address link without a redirect hop', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: 12.9357, lng: 77.7128 } } }],
      }),
    } as unknown as Response);

    expect(
      await resolveCoordinatesFromMapLink(
        'https://www.google.com/maps?q=Sobha+Dream+Acres,+Panathur'
      )
    ).toEqual({ latitude: 12.9357, longitude: 77.7128 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('address')
    ).toBe('Sobha Dream Acres, Panathur');
  });

  it('[PRP-018] does not geocode a dead link that lands on the Maps home page', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://www.google.com/maps',
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveCoordinatesFromMapLink('https://maps.app.goo.gl/gone')
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the geocoder finds nothing for the named place', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/place/Nowhere+Layout',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
      } as unknown as Response);

    expect(
      await resolveCoordinatesFromMapLink('https://maps.app.goo.gl/nowhere')
    ).toBeNull();
  });

  it('never throws when the redirect hop fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await resolveCoordinatesFromMapLink('https://maps.app.goo.gl/dead')
    ).toBeNull();
  });
});

describe('resolveMapPin', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  const routeUrl =
    'https://www.google.com/maps/dir/12.8411525,77.6401829/Pash+Luxury+Apartments/data=!4m10!4m9!1m1!4e1!1m5!1m4!1s0x3bae6b888a6e94b1:0x1b121bd3b0d39e49!8m2!3d12.8632491!4d77.6536115!3e0?utm_source=mstt_0&g_st=aw';

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('[PRP-042] stores a short link that opens a route as a pin on the destination', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: routeUrl,
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveMapPin('https://maps.app.goo.gl/F93K1ybtNMMc7Y8k9?g_st=aw')
    ).toEqual({
      coordinates: { latitude: 12.8632491, longitude: 77.6536115 },
      mapLink:
        'https://www.google.com/maps/search/?api=1&query=12.8632491,77.6536115',
    });
  });

  it('[PRP-042] stores a pasted route as a pin without a network call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const pin = await resolveMapPin(routeUrl);
    expect(pin.mapLink).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.8632491,77.6536115'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[PRP-042] stores a Street View short link as a pin on the camera point', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://www.google.com/maps/@12.9347296,77.614563,3a,75y,215.83h,96.36t/data=!3m5!1e1!3m3!1sabc!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com',
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveMapPin('https://maps.app.goo.gl/RUBjJ59KjHgzNAnR6')
    ).toEqual({
      coordinates: { latitude: 12.9347296, longitude: 77.614563 },
      mapLink:
        'https://www.google.com/maps/search/?api=1&query=12.9347296,77.614563',
    });
  });

  it('[PRP-042] geocodes a named destination and pins the point, not the name', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/dir/My+Location/Pash+Luxury+Apartments/@12.85,77.64,13z',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [
            {
              place_id: 'pla',
              formatted_address: 'Pash Luxury Apartments, Bengaluru',
              geometry: { location: { lat: 12.8633, lng: 77.6536 } },
            },
          ],
        }),
      } as unknown as Response);

    expect(await resolveMapPin('https://maps.app.goo.gl/named')).toEqual({
      coordinates: { latitude: 12.8633, longitude: 77.6536 },
      mapLink:
        'https://www.google.com/maps/search/?api=1&query=12.8633,77.6536',
    });
  });

  it('[PRP-042] keeps a pin link exactly as the lister pasted it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      url: 'https://www.google.com/maps/place/Radhe+Medical/@12.8706889,77.5830609,82m/data=!3m1!1e3!4m6!3m5!1s0x1!8m2!3d12.8707505!4d77.5828702',
      json: async () => ({}),
    } as unknown as Response);

    expect(
      await resolveMapPin('https://maps.app.goo.gl/jnmEijCWr74XxQHL8')
    ).toEqual({
      coordinates: { latitude: 12.8707505, longitude: 77.5828702 },
      mapLink: 'https://maps.app.goo.gl/jnmEijCWr74XxQHL8',
    });
  });

  it('[PRP-042] keeps the link when the redirect fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await resolveMapPin('https://maps.app.goo.gl/dead')).toEqual({
      coordinates: null,
      mapLink: 'https://maps.app.goo.gl/dead',
    });
  });
});

describe('resolveLocationFromGoogleMapLink on a Street View link', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('[PRP-042] keeps the camera point and the rewritten pin when nobody can name the place', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/@12.9347296,77.614563,3a,75y,215.83h,96.36t/data=!3m5!1e1!3m3!1sabc!2e0',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        url: '',
        json: async () => ({}),
      } as unknown as Response);

    expect(
      await resolveLocationFromGoogleMapLink(
        'https://maps.app.goo.gl/RUBjJ59KjHgzNAnR6?g_st=aw'
      )
    ).toEqual({
      location: null,
      sublocality: null,
      city: null,
      state: null,
      latitude: 12.9347296,
      longitude: 77.614563,
      mapLink:
        'https://www.google.com/maps/search/?api=1&query=12.9347296,77.614563',
    });
  });
});

describe('resolveLocationFromGoogleMapLink on a route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('[PRP-042] names the pin link to store beside the destination it resolved', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://www.google.com/maps/dir/12.8411525,77.6401829/Pash+Luxury+Apartments/data=!4m10!4m9!1m1!4e1!1m5!1m4!1s0x1!8m2!3d12.8632491!4d77.6536115!3e0',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        url: '',
        json: async () => ({
          display_name: 'Chikkathoguru, Bengaluru, Karnataka, India',
          address: {
            suburb: 'Chikkathoguru',
            city: 'Bengaluru',
            state: 'Karnataka',
          },
        }),
      } as unknown as Response);

    const result = await resolveLocationFromGoogleMapLink(
      'https://maps.app.goo.gl/F93K1ybtNMMc7Y8k9?g_st=aw'
    );

    expect(result).toMatchObject({
      sublocality: 'Chikkathoguru',
      latitude: 12.8632491,
      longitude: 77.6536115,
      mapLink:
        'https://www.google.com/maps/search/?api=1&query=12.8632491,77.6536115',
    });
  });
});
