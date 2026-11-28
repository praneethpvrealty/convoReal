import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Coverage for the dual auth transport in createClient() — the mobile
 * app sends `Authorization: Bearer <jwt>` (no cookies), the web app
 * sends session cookies, and Vercel Cron sends `Bearer ${CRON_SECRET}`
 * (an opaque non-JWT that must NOT be forwarded to PostgREST).
 * See docs/mobile-app-implementation-plan.md.
 */

// Three-part JWT shape; contents don't matter — validation happens in GoTrue.
const FAKE_JWT = 'aaa.bbb.ccc';

const h = vi.hoisted(() => ({
  state: {
    authorization: null as string | null,
  },
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? h.state.authorization : null,
    }),
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: h.createServerClient,
}));

let createClient: typeof import('./server').createClient;

beforeEach(async () => {
  h.state.authorization = null;
  h.createServerClient.mockReset();
  h.getUser.mockReset();
  h.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  h.getClaims.mockReset();
  h.getClaims.mockResolvedValue({
    data: { claims: { sub: 'user-1' } },
    error: null,
  });
  h.createServerClient.mockImplementation(() => ({
    auth: { getUser: h.getUser, getClaims: h.getClaims },
  }));
  vi.resetModules();
  ({ createClient } = await import('./server'));
});

describe('createClient bearer transport', () => {
  it('forwards a bearer JWT to PostgREST and validates it via getUser', async () => {
    h.state.authorization = `Bearer ${FAKE_JWT}`;

    const client = await createClient();
    const options = h.createServerClient.mock.calls[0][2];
    expect(options.global.headers.Authorization).toBe(`Bearer ${FAKE_JWT}`);

    // Route code calls getUser() with no args; it must validate the bearer JWT.
    await client.auth.getUser();
    expect(h.getUser).toHaveBeenCalledWith(FAKE_JWT);
  });

  it('[ACC-011] verifies the bearer JWT, not a cookie session, when claims are read with no args', async () => {
    h.state.authorization = `Bearer ${FAKE_JWT}`;

    const client = await createClient();
    await client.auth.getClaims();
    expect(h.getClaims).toHaveBeenCalledWith(FAKE_JWT, undefined);
  });

  it('prefers an explicitly passed JWT over the header token', async () => {
    h.state.authorization = `Bearer ${FAKE_JWT}`;

    const client = await createClient();
    await client.auth.getUser('xxx.yyy.zzz');
    expect(h.getUser).toHaveBeenCalledWith('xxx.yyy.zzz');
  });

  it('uses the cookie path when there is no Authorization header', async () => {
    await createClient();
    const options = h.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
    expect(options.cookies.getAll).toBeDefined();
  });

  it('ignores a non-JWT bearer token (Vercel Cron secret)', async () => {
    h.state.authorization = 'Bearer some-opaque-cron-secret';

    await createClient();
    const options = h.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
  });
});
