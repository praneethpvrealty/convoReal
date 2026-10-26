import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signedIn: true,
  isReadOnly: false,
  role: 'agent',
  viewers: {} as Record<
    string,
    { own: boolean; canImport: boolean; importedId: string | null }
  >,
  viewerCalls: [] as string[][],
  importResult: { kind: 'imported', id: 'copy-1', title: 'Villa' } as Record<
    string,
    unknown
  >,
  importCalls: [] as string[],
}));

class UnauthorizedError extends Error {
  status = 401;
}

function ctx() {
  if (!state.signedIn) throw new UnauthorizedError('Unauthorized');
  return {
    accountId: 'acct-me',
    userId: 'user-me',
    role: state.role,
    isReadOnly: state.isReadOnly,
    supabase: {},
  };
}

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ctx(),
  requireWriteRole: async () => {
    const c = ctx();
    if (c.isReadOnly)
      throw Object.assign(new Error('Read-only'), { status: 403 });
    return c;
  },
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: (error as { status?: number }).status ?? 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit: async () => ({ allowed: true }),
  gateResponse: () => Response.json({}, { status: 402 }),
}));

vi.mock('@/lib/inventory/import-shared-property', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/inventory/import-shared-property')
    >();
  return {
    UUID_RE: actual.UUID_RE,
    MAX_VIEWER_LOOKUP: actual.MAX_VIEWER_LOOKUP,
    showcaseImportViewers: async (_ctx: unknown, ids: string[]) => {
      state.viewerCalls.push(ids);
      return Object.fromEntries(
        ids
          .filter((id) => state.viewers[id])
          .map((id) => [id, state.viewers[id]])
      );
    },
    importSharedProperty: async (_ctx: unknown, id: string) => {
      state.importCalls.push(id);
      return state.importResult;
    },
  };
});

import { GET, OPTIONS, POST } from './route';

const PROPERTY_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '66666666-7777-4888-9999-000000000000';
const TENANT = 'https://aryavartaventures.convoreal.com';
const APP = 'https://www.convoreal.com';

function get(origin?: string, propertyId = PROPERTY_ID) {
  return GET(
    new Request(
      `${APP}/api/inventory/showcase-import?property_id=${propertyId}`,
      {
        headers: origin ? { origin } : {},
      }
    )
  );
}

function getMany(ids: string[], origin?: string) {
  return GET(
    new Request(
      `${APP}/api/inventory/showcase-import?property_ids=${ids.join(',')}`,
      { headers: origin ? { origin } : {} }
    )
  );
}

function post(origin: string | undefined, body: unknown) {
  return POST(
    new Request(`${APP}/api/inventory/showcase-import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.signedIn = true;
  state.isReadOnly = false;
  state.role = 'agent';
  state.viewers = {
    [PROPERTY_ID]: { own: false, canImport: true, importedId: null },
    [OTHER_ID]: { own: false, canImport: true, importedId: 'copy-old' },
  };
  state.viewerCalls = [];
  state.importResult = { kind: 'imported', id: 'copy-1', title: 'Villa' };
  state.importCalls = [];
});

describe('OPTIONS /api/inventory/showcase-import', () => {
  it('[PRP-053] answers a tenant showcase origin with credentialed CORS headers', async () => {
    const res = await OPTIONS(
      new Request(`${APP}/api/inventory/showcase-import`, {
        method: 'OPTIONS',
        headers: { origin: TENANT },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Content-Type'
    );
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('[PRP-053] gives a foreign origin no CORS headers at all', async () => {
    for (const origin of [
      'https://evil.com',
      'https://convoreal.com.evil.com',
      'http://aryavartaventures.convoreal.com',
    ]) {
      const res = await OPTIONS(
        new Request(`${APP}/api/inventory/showcase-import`, {
          method: 'OPTIONS',
          headers: { origin },
        })
      );
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });
});

describe('GET /api/inventory/showcase-import', () => {
  it('[PRP-053] tells a signed-out visitor apart, with the CORS headers the showcase needs to read it', async () => {
    state.signedIn = false;
    for (const res of [
      await get(TENANT),
      await getMany([PROPERTY_ID], TENANT),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
    }
    expect(state.viewerCalls).toHaveLength(0);
  });

  it('[PRP-053] answers for every listing of a batch in one call, leaving out the ones it does not know', async () => {
    const unknown = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const res = await getMany([PROPERTY_ID, OTHER_ID, unknown], TENANT);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      data: {
        viewers: {
          [PROPERTY_ID]: { own: false, canImport: true, importedId: null },
          [OTHER_ID]: { own: false, canImport: true, importedId: 'copy-old' },
        },
      },
    });
    expect(state.viewerCalls).toEqual([[PROPERTY_ID, OTHER_ID, unknown]]);
  });

  it('[PRP-053] still answers a single property_id with the viewer itself', async () => {
    const res = await get(TENANT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { own: false, canImport: true, importedId: null },
    });
    state.viewers = {};
    expect((await get()).status).toBe(404);
  });

  it('[PRP-053] refuses a malformed id, an empty list and more than the route\u2019s limit', async () => {
    expect((await get(undefined, 'CR-001')).status).toBe(400);
    expect((await getMany([PROPERTY_ID, 'CR-001'])).status).toBe(400);
    expect((await getMany([])).status).toBe(400);
    const tooMany = Array.from(
      { length: 61 },
      (_, i) => `11111111-2222-4333-8444-${String(i).padStart(12, '0')}`
    );
    expect((await getMany(tooMany)).status).toBe(400);
    expect((await getMany(tooMany.slice(0, 60))).status).toBe(200);
    expect(state.viewerCalls).toHaveLength(1);
  });
});

describe('POST /api/inventory/showcase-import', () => {
  it('[PRP-053] imports the listing for a signed-in agent on a tenant showcase', async () => {
    const res = await post(TENANT, { property_id: PROPERTY_ID });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
    expect(await res.json()).toEqual({
      data: { id: 'copy-1', title: 'Villa' },
    });
    expect(state.importCalls).toEqual([PROPERTY_ID]);
  });

  it('[PRP-053] reports an existing copy without importing again', async () => {
    state.importResult = { kind: 'already_imported', id: 'copy-old' };
    const res = await post(undefined, { property_id: PROPERTY_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: 'copy-old', alreadyImported: true },
    });
  });

  it('[PRP-053] refuses a confidential listing, the account’s own listing and a read-only member', async () => {
    state.importResult = { kind: 'withheld' };
    expect((await post(undefined, { property_id: PROPERTY_ID })).status).toBe(
      403
    );
    state.importResult = { kind: 'own_listing', id: PROPERTY_ID };
    expect((await post(undefined, { property_id: PROPERTY_ID })).status).toBe(
      409
    );
    state.isReadOnly = true;
    expect((await post(undefined, { property_id: PROPERTY_ID })).status).toBe(
      403
    );
  });

  it('[PRP-053] requires a well-formed property id and a session', async () => {
    expect((await post(undefined, { property_id: 'CR-001' })).status).toBe(400);
    expect((await post(undefined, {})).status).toBe(400);
    state.signedIn = false;
    const res = await post(TENANT, { property_id: PROPERTY_ID });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
  });
});
