import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectCalls,
  rows,
  placesAutocomplete,
  placeDetails,
  hasGoogleMapsKey,
} = vi.hoisted(() => ({
  selectCalls: [] as Array<[string, unknown]>,
  rows: { data: [] as unknown[] },
  placesAutocomplete: vi.fn(),
  placeDetails: vi.fn(),
  hasGoogleMapsKey: vi.fn(() => true),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from() {
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          selectCalls.push([column, value]);
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: rows.data, error: null });
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/maps/google-places', () => ({
  placesAutocomplete,
  placeDetails,
  hasGoogleMapsKey,
}));

const { GET } = await import('./route');
const { RATE_LIMITS, __resetRateLimitForTests } =
  await import('@/lib/rate-limit');

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let ip = 0;

function req(q: string, opts: { account?: string; ip?: string } = {}) {
  const params = new URLSearchParams({
    account_id: opts.account ?? ACCOUNT,
    q,
  });
  return new Request(`http://localhost/api/public/properties/near?${params}`, {
    headers: { 'x-forwarded-for': opts.ip ?? `10.1.0.${++ip}` },
  });
}

beforeEach(() => {
  __resetRateLimitForTests();
  selectCalls.length = 0;
  placesAutocomplete.mockReset();
  placeDetails.mockReset();
  hasGoogleMapsKey.mockReturnValue(true);
  rows.data = [
    {
      id: 'jayanagar',
      latitude: 12.9299,
      longitude: 77.5826,
      city: 'Bengaluru',
      sublocality: 'Jayanagar',
    },
    {
      id: 'yelahanka',
      latitude: 13.1,
      longitude: 77.59,
      city: 'Bengaluru',
      sublocality: 'Yelahanka',
    },
  ];
});

describe('GET /api/public/properties/near', () => {
  it('[PRP-013] resolves a partial area name in the inventory city and returns nearby listings without coordinates', async () => {
    placesAutocomplete.mockResolvedValue([
      {
        place_id: 'basavanagudi',
        main_text: 'Basavanagudi',
        secondary_text: 'Bengaluru, Karnataka, India',
      },
    ]);
    placeDetails.mockResolvedValue({
      place_id: 'basavanagudi',
      name: 'Basavanagudi',
      formatted_address: 'Basavanagudi, Bengaluru, Karnataka, India',
      latitude: 12.9416,
      longitude: 77.5738,
      sublocality: 'Basavanagudi',
      city: 'Bengaluru',
      state: 'Karnataka',
    });

    const res = await GET(req('basavan'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(placesAutocomplete).toHaveBeenCalledWith(
      'basavan, Bengaluru',
      expect.any(String),
      {
        regionsOnly: true,
        bias: {
          latitude: expect.closeTo(13.01495, 6),
          longitude: expect.closeTo(77.5863, 6),
          radiusKm: 30,
        },
      }
    );
    const session = placesAutocomplete.mock.calls[0][1];
    expect(placeDetails).toHaveBeenCalledWith('basavanagudi', session);
    expect(body).toEqual({
      data: {
        label: 'Basavanagudi',
        results: [{ id: 'jayanagar', tier: 'nearby', distance_km: 1.5 }],
      },
    });
    expect(JSON.stringify(body)).not.toContain('12.9299');
    expect(selectCalls).toEqual([
      ['account_id', ACCOUNT],
      ['is_published', true],
      ['status', 'Available'],
    ]);
  });

  it('reuses a cached place for a repeated search', async () => {
    placesAutocomplete.mockResolvedValue([]);
    await GET(req('cached place'));
    await GET(req('Cached Place'));
    expect(placesAutocomplete).toHaveBeenCalledTimes(1);
    expect(placeDetails).not.toHaveBeenCalled();
  });

  it('does not share a biased place between showcases whose inventories sit apart', async () => {
    placesAutocomplete.mockResolvedValue([]);
    await GET(req('shared place'));
    rows.data = [
      {
        id: 'mysuru',
        latitude: 12.3,
        longitude: 76.64,
        city: 'Bengaluru',
        sublocality: 'Vijayanagar',
      },
    ];
    await GET(req('shared place', { account: `${ACCOUNT.slice(0, -1)}b` }));
    expect(placesAutocomplete).toHaveBeenCalledTimes(2);
  });

  it('falls back to named-area matches when Places cannot resolve the text', async () => {
    placesAutocomplete.mockRejectedValue(new Error('quota'));
    const res = await GET(req('Jayanagar 9th'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { label: 'Jayanagar 9th', results: [] },
    });
  });

  it('falls back to named-area matches when Maps is not configured', async () => {
    hasGoogleMapsKey.mockReturnValue(false);
    const res = await GET(req('Jayanagar'));
    expect(placesAutocomplete).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      data: {
        label: 'Jayanagar',
        results: [{ id: 'jayanagar', tier: 'exact', distance_km: null }],
      },
    });
  });

  it('rejects a malformed account or a too-short query before spending anything', async () => {
    expect((await GET(req('basavan', { account: 'nope' }))).status).toBe(400);
    expect((await GET(req('ba'))).status).toBe(400);
    expect(placesAutocomplete).not.toHaveBeenCalled();
  });

  it('429s one visitor past the per-IP budget', async () => {
    placesAutocomplete.mockResolvedValue([]);
    for (let i = 0; i < RATE_LIMITS.publicNearSearch.limit; i++) {
      expect(
        (await GET(req('rate limited', { ip: '203.0.113.9' }))).status
      ).toBe(200);
    }
    expect((await GET(req('rate limited', { ip: '203.0.113.9' }))).status).toBe(
      429
    );
  });
});
