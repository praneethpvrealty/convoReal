import { beforeEach, describe, expect, it, vi } from 'vitest';

const events: string[] = [];
const propertyUpdates: Record<string, unknown>[] = [];
const afterCallbacks: Array<() => unknown> = [];
let config: Record<string, unknown> | null = null;
let configError: Error | null = null;

function table(name: string) {
  const chain = () => query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    select: chain,
    eq: chain,
    neq: chain,
    in: chain,
    update: (patch: Record<string, unknown>) => {
      if (name === 'properties') {
        propertyUpdates.push(patch);
        events.push('save');
      }
      return query;
    },
    maybeSingle: () =>
      Promise.resolve(
        name === 'whatsapp_config'
          ? { data: config, error: configError }
          : {
              data: {
                id: 'p1',
                type: 'Apartment',
                user_id: 'user-1',
                status: 'Available',
                listing_type: 'Sale',
                price: 100,
              },
              error: null,
            }
      ),
    single: () => Promise.resolve({ data: { id: 'p1' }, error: null }),
    then: <T>(onfulfilled: (value: unknown) => T | PromiseLike<T>) =>
      Promise.resolve({ data: [{ id: 'p1' }], error: null }).then(onfulfilled),
  };
  return query;
}

const { autoSync } = vi.hoisted(() => ({ autoSync: vi.fn() }));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'account-1',
    role: 'owner',
    userId: 'user-1',
    supabase: { from: table },
  }),
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: table }),
}));

vi.mock('@/lib/maps/google-places', () => ({
  hasGoogleMapsKey: () => false,
  geocodeAddress: vi.fn(),
}));

vi.mock('@/lib/whatsapp/catalog-sync-helper', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/catalog-sync-helper')
  >()),
  autoSyncPropertyCatalogIfNeeded: autoSync,
}));

import { PUT } from './route';

function save() {
  return PUT(
    new Request('http://localhost/api/properties/p1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'Renamed villa' }),
    }),
    { params: Promise.resolve({ id: 'p1' }) }
  );
}

beforeEach(() => {
  events.length = 0;
  propertyUpdates.length = 0;
  afterCallbacks.length = 0;
  config = { catalog_id: 'c1', auto_sync_catalog: true };
  configError = null;
  autoSync.mockReset();
  autoSync.mockImplementation(async () => {
    events.push('sync');
  });
});

describe('[PRP-044] PUT /api/properties/[id] catalog sync state', () => {
  it('clears the previous sync in the save, before responding, and syncs afterwards', async () => {
    const res = await save();
    expect(res.status).toBe(200);
    expect(propertyUpdates).toHaveLength(1);
    expect(propertyUpdates[0]).toMatchObject({
      title: 'Renamed villa',
      meta_catalog_synced_at: null,
      meta_catalog_error: null,
    });
    expect(events).toEqual(['save']);
    expect(autoSync).not.toHaveBeenCalled();

    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(autoSync).toHaveBeenCalledWith(expect.anything(), 'p1', 'account-1');
    expect(events).toEqual(['save', 'sync']);
  });

  it.each([
    ['auto-sync is off', { catalog_id: 'c1', auto_sync_catalog: false }],
    [
      'the account has no catalog',
      { catalog_id: null, auto_sync_catalog: true },
    ],
    ['WhatsApp is not connected', null],
  ])('keeps a manual sync when %s', async (_label, value) => {
    config = value;
    const res = await save();
    expect(res.status).toBe(200);
    expect(propertyUpdates).toHaveLength(1);
    expect(propertyUpdates[0]).not.toHaveProperty('meta_catalog_synced_at');
    expect(propertyUpdates[0]).not.toHaveProperty('meta_catalog_error');
  });

  it('fails the save without writing when the catalog settings cannot be read', async () => {
    configError = new Error('timeout');
    const res = await save();
    expect(res.status).toBe(500);
    expect(propertyUpdates).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });
});
