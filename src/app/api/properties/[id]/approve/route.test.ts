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
    update: (patch: Record<string, unknown>) => {
      propertyUpdates.push(patch);
      events.push('approve');
      return query;
    },
    maybeSingle: () =>
      Promise.resolve(
        name === 'whatsapp_config'
          ? { data: config, error: configError }
          : {
              data: {
                id: 'p1',
                title: 'Villa',
                location: 'Whitefield',
                status: 'Pending Review',
                owner_contact_id: null,
                owner: null,
              },
              error: null,
            }
      ),
    single: () => Promise.resolve({ data: { id: 'p1' }, error: null }),
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

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

vi.mock('@/lib/whatsapp/catalog-sync-helper', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/catalog-sync-helper')
  >()),
  autoSyncPropertyCatalogIfNeeded: autoSync,
}));

import { POST } from './route';

function approve() {
  return POST(
    new Request('http://localhost/api/properties/p1/approve', {
      method: 'POST',
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

describe('[PRP-044] POST /api/properties/[id]/approve catalog sync state', () => {
  it('clears the previous sync in the approval, before responding, and syncs afterwards', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(propertyUpdates).toEqual([
      {
        status: 'Available',
        is_published: true,
        meta_catalog_synced_at: null,
        meta_catalog_error: null,
      },
    ]);
    expect(events).toEqual(['approve']);
    expect(autoSync).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(autoSync).toHaveBeenCalledWith(expect.anything(), 'p1', 'account-1');
    expect(events).toEqual(['approve', 'sync']);
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
    const res = await approve();
    expect(res.status).toBe(200);
    expect(propertyUpdates).toEqual([
      { status: 'Available', is_published: true },
    ]);
  });

  it('leaves the listing unapproved when the catalog settings cannot be read', async () => {
    configError = new Error('timeout');
    const res = await approve();
    expect(res.status).toBe(500);
    expect(propertyUpdates).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });
});
