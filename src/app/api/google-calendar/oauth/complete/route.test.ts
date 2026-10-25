import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signOAuthState } from '@/lib/meta-ads/oauth-state';

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ userId: 'user-1', accountId: 'acct-1' }),
  toErrorResponse: () => Response.json({ error: 'auth' }, { status: 401 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/google-calendar/oauth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/google-calendar/oauth')>();
  return { ...actual, completeGoogleCalendarConnection: mocks.complete };
});

import { POST } from './route';

function state(overrides: Record<string, unknown>) {
  return signOAuthState(
    {
      accountId: 'acct-1',
      userId: 'user-1',
      client: 'mobile',
      nonce: 'n',
      ts: Date.now(),
      ...overrides,
    },
    'secret'
  );
}

function post(body: unknown) {
  return POST(
    new Request('https://app.test/api/google-calendar/oauth/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret');
  mocks.complete.mockReset().mockResolvedValue({ googleEmail: 'me@x.com' });
});

describe('[CAL-015] POST /api/google-calendar/oauth/complete', () => {
  it('[CAL-015] connects the signed-in member when the state was minted for them on mobile', async () => {
    const res = await post({ code: 'c', state: state({}) });
    expect(res.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), {
      code: 'c',
      accountId: 'acct-1',
      userId: 'user-1',
    });
  });

  it('[CAL-015] refuses a state minted for another member, another account or the web flow', async () => {
    for (const overrides of [
      { userId: 'user-2' },
      { accountId: 'acct-2' },
      { client: 'web' },
      { ts: Date.now() - 11 * 60_000 },
    ]) {
      const res = await post({ code: 'c', state: state(overrides) });
      expect(res.status).toBe(400);
    }
    expect(
      (
        await post({
          code: 'c',
          state: signOAuthState(
            {
              accountId: 'acct-1',
              userId: 'user-1',
              client: 'mobile',
              nonce: 'n',
              ts: Date.now(),
            },
            'wrong'
          ),
        })
      ).status
    ).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
