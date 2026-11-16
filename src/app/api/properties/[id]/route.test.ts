import { beforeEach, describe, expect, it, vi } from 'vitest';

const events: string[] = [];
const propertyUpdates: Record<string, unknown>[] = [];
const afterCallbacks: Array<() => unknown> = [];
let config: Record<string, unknown> | null = null;
let configError: Error | null = null;
const baseRow: Record<string, unknown> = {
  id: 'p1',
  type: 'Apartment',
  user_id: 'user-1',
  status: 'Available',
  listing_type: 'Sale',
  price: 100,
};
let existingRow: Record<string, unknown> = baseRow;
let missedWrites = 0;
let role = 'owner';
let rowAfterMiss: Record<string, unknown> | null = null;

function table(name: string) {
  const chain = () => query;
  let isUpdate = false;
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
        isUpdate = true;
      }
      return query;
    },
    maybeSingle: () =>
      Promise.resolve(
        name === 'whatsapp_config'
          ? { data: config, error: configError }
          : {
              data:
                rowAfterMiss && propertyUpdates.length > 0
                  ? rowAfterMiss
                  : existingRow,
              error: null,
            }
      ),
    single: () => Promise.resolve({ data: { id: 'p1' }, error: null }),
    then: <T>(onfulfilled: (value: unknown) => T | PromiseLike<T>) =>
      Promise.resolve({
        data:
          isUpdate && missedWrites > 0 && missedWrites-- > 0
            ? []
            : [{ id: 'p1' }],
        error: null,
      }).then(onfulfilled),
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
    role,
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

import {
  PROPERTY_EDIT_VERSION_FIELDS,
  propertyEditVersion,
  propertyEditVersions,
} from '@/lib/inventory/edit-version';

import { maskPropertyForViewer } from '@/lib/inventory/location-guard';
import type { Property } from '@/types';

import { PUT } from './route';

function save(extra: Record<string, unknown> = {}) {
  return PUT(
    new Request('http://localhost/api/properties/p1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'Renamed villa', ...extra }),
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
  existingRow = baseRow;
  missedWrites = 0;
  rowAfterMiss = null;
  role = 'owner';
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

describe('[PRP-062] PUT /api/properties/[id] edit version', () => {
  function fullRow(overrides: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = {
      ...baseRow,
      updated_at: '2026-11-16T05:00:00.000000+00:00',
    };
    for (const field of PROPERTY_EDIT_VERSION_FIELDS) row[field] ??= null;
    return { ...row, ...overrides };
  }

  it('saves when the listing still matches the copy the form was opened with', async () => {
    existingRow = fullRow();
    const res = await save({
      expected_version: propertyEditVersion(fullRow()),
    });
    expect(res.status).toBe(200);
    expect(propertyUpdates).toHaveLength(1);
  });

  it('refuses with 409 PROPERTY_CHANGED and writes nothing when the listing has changed since', async () => {
    existingRow = fullRow({ price: 90 });
    const res = await save({
      expected_version: propertyEditVersion(fullRow()),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PROPERTY_CHANGED');
    expect(propertyUpdates).toHaveLength(0);
  });

  it('saves over a changed listing when the request carries no version', async () => {
    existingRow = fullRow({ price: 90 });
    const res = await save();
    expect(res.status).toBe(200);
    expect(propertyUpdates).toHaveLength(1);
  });

  it('refuses when only the owner or the rent roll changed', async () => {
    existingRow = fullRow({ owner_contact_id: 'contact-2' });
    const res = await save({
      expected_version: propertyEditVersion(fullRow()),
    });
    expect(res.status).toBe(409);
    expect(propertyUpdates).toHaveLength(0);
  });

  it('refuses the web form when a column only it writes changed, and still saves the mobile editor', async () => {
    existingRow = fullRow({ notes: 'Owner wants a quick close' });
    const [webVersion, mobileVersion] = propertyEditVersions(fullRow());

    const web = await save({ expected_version: webVersion });
    expect(web.status).toBe(409);
    expect(propertyUpdates).toHaveLength(0);

    const mobile = await save({ expected_version: mobileVersion });
    expect(mobile.status).toBe(200);
  });

  it('accepts the version of the location-masked row a non-owner agent was served', async () => {
    const guarded = fullRow({
      user_id: 'someone-else',
      location_privacy: 'locality',
      location: '12 Exact Street',
      sublocality: 'HBR Layout',
      city: 'Bengaluru',
    });
    const served = maskPropertyForViewer(guarded as unknown as Property, {
      role: 'agent',
      userId: 'user-1',
    }) as unknown as Record<string, unknown>;
    expect(served.location).not.toBe('12 Exact Street');
    existingRow = guarded;
    role = 'agent';
    const res = await save({ expected_version: propertyEditVersion(served) });
    expect(res.status).toBe(200);
  });

  it('retries the pinned write when only background work touched the row in between', async () => {
    existingRow = fullRow();
    missedWrites = 1;
    rowAfterMiss = fullRow({ updated_at: '2026-11-16T05:00:01.000000+00:00' });
    const res = await save({
      expected_version: propertyEditVersion(fullRow()),
    });
    expect(res.status).toBe(200);
    expect(propertyUpdates).toHaveLength(2);
  });

  it('refuses when an edit landed between the check and the write', async () => {
    existingRow = fullRow();
    missedWrites = 1;
    rowAfterMiss = fullRow({
      price: 90,
      updated_at: '2026-11-16T05:00:01.000000+00:00',
    });
    const res = await save({
      expected_version: propertyEditVersion(fullRow()),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PROPERTY_CHANGED');
  });
});
