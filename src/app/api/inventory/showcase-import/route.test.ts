import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signedIn: true,
  isReadOnly: false,
  role: 'agent',
  source: null as Record<string, unknown> | null,
  existingCopy: null as { id: string } | null,
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
    lookupSharedPropertySource: async () => state.source,
    findImportedCopy: async () => state.existingCopy,
    importSharedProperty: async (_ctx: unknown, id: string) => {
      state.importCalls.push(id);
      return state.importResult;
    },
  };
});

import { GET, OPTIONS, POST } from './route';

const PROPERTY_ID = '11111111-2222-4333-8444-555555555555';
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
  state.source = {
    id: PROPERTY_ID,
    account_id: 'acct-them',
    type: 'Apartment',
    is_published: true,
    showcase_visibility: null,
  };
  state.existingCopy = null;
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
    const res = await get(TENANT);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT);
  });

  it('[PRP-053] lets an agent of another account import a listing it has not got', async () => {
    const res = await get(TENANT);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      data: { own: false, canImport: true, importedId: null },
    });
  });

  it('[PRP-053] points at the copy this account already holds', async () => {
    state.existingCopy = { id: 'copy-old' };
    expect(await (await get()).json()).toEqual({
      data: { own: false, canImport: true, importedId: 'copy-old' },
    });
  });

  it('[PRP-053] marks the account’s own listing and offers nothing', async () => {
    state.source = { ...state.source, account_id: 'acct-me' };
    expect(await (await get()).json()).toEqual({
      data: { own: true, canImport: false, importedId: null },
    });
  });

  it('[PRP-053] withholds the import from a read-only member, a viewer and for a teaser-gated listing', async () => {
    state.isReadOnly = true;
    expect((await (await get()).json()).data.canImport).toBe(false);

    state.isReadOnly = false;
    state.role = 'viewer';
    expect((await (await get()).json()).data.canImport).toBe(false);

    state.role = 'agent';
    state.source = { ...state.source, showcase_visibility: 'teaser' };
    expect((await (await get()).json()).data.canImport).toBe(false);
  });

  it('[PRP-053] rejects a malformed id and an unknown listing', async () => {
    expect((await get(undefined, 'CR-001')).status).toBe(400);
    state.source = null;
    expect((await get()).status).toBe(404);
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
