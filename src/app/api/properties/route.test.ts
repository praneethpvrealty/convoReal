import { beforeEach, describe, expect, it, vi } from 'vitest';

const orFilters: string[] = [];
const updates: Array<{ patch: Record<string, unknown>; id: unknown }> = [];
const ungeocodedRows: Array<Record<string, unknown>> = [];

function propertiesQuery() {
  let ungeocoded = false;
  let patch: Record<string, unknown> | null = null;
  const chain = () => query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    select: chain,
    eq: (column: string, value: unknown) => {
      if (patch && column === 'id') updates.push({ patch, id: value });
      return query;
    },
    neq: chain,
    gt: chain,
    gte: chain,
    lte: chain,
    not: chain,
    limit: chain,
    order: chain,
    range: chain,
    is: (column: string, value: unknown) => {
      if (column === 'latitude' && value === null) ungeocoded = true;
      return query;
    },
    or: (filter: string) => {
      orFilters.push(filter);
      return query;
    },
    update: (next: Record<string, unknown>) => {
      patch = next;
      return query;
    },
    then: <T>(onfulfilled: (value: unknown) => T | PromiseLike<T>) =>
      Promise.resolve(
        ungeocoded
          ? { data: ungeocodedRows, error: null, count: ungeocodedRows.length }
          : { data: [], error: null, count: 0 }
      ).then(onfulfilled),
  };
  return query;
}

const { geocodeAddress } = vi.hoisted(() => ({ geocodeAddress: vi.fn() }));

vi.mock('@/lib/maps/google-places', () => ({
  hasGoogleMapsKey: () => true,
  geocodeAddress,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'account-1',
    role: 'owner',
    userId: 'user-1',
    supabase: { from: () => propertiesQuery() },
  }),
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/agents/source-inventory-sync', () => ({
  syncAgentSourceInventory: async () => ({ imported: 0, matched: 0 }),
}));

import { GET } from './route';

beforeEach(() => {
  orFilters.length = 0;
  updates.length = 0;
  ungeocodedRows.length = 0;
  geocodeAddress.mockReset();
});

describe('GET /api/properties location filters', () => {
  it('combines selected localities into one OR filter', async () => {
    const response = await GET(
      new Request(
        'http://test/api/properties?location=Whitefield&location=Koramangala'
      )
    );

    expect(response.status).toBe(200);
    expect(orFilters).toHaveLength(1);
    expect(orFilters[0]).toContain('location.ilike."%whitefield%"');
    expect(orFilters[0]).toContain('location.ilike."%koramangala%"');
  });
});

describe('GET /api/properties near-search self-heal', () => {
  const nearUrl =
    'http://test/api/properties?near_lat=12.93&near_lng=77.58&near_label=Jayanagar';

  it('[PRP-025] only picks rows never tried or last tried over 30 days ago', async () => {
    const response = await GET(new Request(nearUrl));

    expect(response.status).toBe(200);
    const retry = orFilters.find((f) =>
      f.startsWith('geocode_attempted_at.is.null,')
    );
    expect(retry).toBeDefined();
    const since = new Date(retry!.replace(/^.*geocode_attempted_at\.lt\./, ''));
    const ageDays = (Date.now() - since.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29.9);
    expect(ageDays).toBeLessThan(30.1);
  });

  it('[PRP-025] stamps geocode_attempted_at on a row Google cannot place instead of leaving it for the next search', async () => {
    ungeocodedRows.push({
      id: 'prop-1',
      location: 'Somewhere nobody mapped',
      city: 'Bengaluru',
      state: null,
      latitude: null,
      longitude: null,
    });
    geocodeAddress.mockResolvedValue(null);

    const response = await GET(new Request(nearUrl));

    expect(response.status).toBe(200);
    expect(geocodeAddress).toHaveBeenCalledWith(
      'Somewhere nobody mapped, Bengaluru'
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('prop-1');
    expect(typeof updates[0].patch.geocode_attempted_at).toBe('string');
  });

  it('persists coordinates, not an attempt stamp, when the geocode succeeds', async () => {
    ungeocodedRows.push({
      id: 'prop-2',
      location: 'Jayanagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      latitude: null,
      longitude: null,
    });
    geocodeAddress.mockResolvedValue({
      latitude: 12.9299,
      longitude: 77.5826,
      place_id: 'jp',
      formatted_address: 'Jayanagar',
    });

    await GET(new Request(nearUrl));

    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      latitude: 12.9299,
      longitude: 77.5826,
    });
    expect(updates[0].patch.geocode_attempted_at).toBeUndefined();
  });
});
