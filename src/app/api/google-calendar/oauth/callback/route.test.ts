import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signOAuthState } from '@/lib/meta-ads/oauth-state';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  nonce: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (mocks.nonce ? { value: mocks.nonce } : undefined),
  }),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ userId: 'user-1', accountId: 'acct-1' }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/google-calendar/oauth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/google-calendar/oauth')>();
  return { ...actual, completeGoogleCalendarConnection: mocks.complete };
});

import { GET } from './route';

function state(client: 'web' | 'mobile', nonce = 'n1') {
  return signOAuthState(
    { accountId: 'acct-1', userId: 'user-1', client, nonce, ts: Date.now() },
    'secret'
  );
}

function get(params: Record<string, string>) {
  const url = new URL('https://app.test/api/google-calendar/oauth/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return GET(new Request(url) as never);
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
  mocks.complete.mockReset().mockResolvedValue({ googleEmail: null });
  mocks.nonce = null;
});

describe('[CAL-015] GET /api/google-calendar/oauth/callback', () => {
  it('[CAL-015] completes a web sign-in only with the matching nonce cookie', async () => {
    const missing = await get({ code: 'c', state: state('web') });
    expect(missing.headers.get('location')).toContain(
      'google_calendar_error=state_bad_signature'
    );
    mocks.nonce = 'other';
    await get({ code: 'c', state: state('web') });
    expect(mocks.complete).not.toHaveBeenCalled();

    mocks.nonce = 'n1';
    const ok = await get({ code: 'c', state: state('web') });
    expect(ok.headers.get('location')).toBe(
      'https://app.test/calendar?google_calendar=connected'
    );
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), {
      code: 'c',
      accountId: 'acct-1',
      userId: 'user-1',
      client: 'web',
    });
  });

  it('[CAL-015] rejects a forged state even with a nonce cookie', async () => {
    mocks.nonce = 'n';
    const forged = signOAuthState(
      {
        accountId: 'acct-1',
        userId: 'user-1',
        client: 'web',
        nonce: 'n',
        ts: Date.now(),
      },
      'wrong'
    );
    const res = await get({ code: 'c', state: forged });
    expect(res.headers.get('location')).toContain('google_calendar_error=');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
