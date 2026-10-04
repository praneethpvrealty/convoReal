import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchange = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: exchange.error }),
    },
  }),
}));

import { GET } from './route';

const SITE = 'https://www.convoreal.com';

function callback(query: string) {
  return GET(new Request(`${SITE}/auth/callback?${query}`));
}

function withNext(next: string) {
  return callback(`code=abc&next=${encodeURIComponent(next)}`);
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    exchange.error = null;
  });

  it('lands on the dashboard when no next is given', async () => {
    const res = await callback('code=abc');
    expect(res.headers.get('location')).toBe(`${SITE}/dashboard`);
  });

  it.each([
    '/den/verify-phone',
    '/buyer/verify-phone',
    '/buyer/verify-phone?next=%2Fbuyer%2Fmatches',
  ])('follows the on-site path %j', async (next) => {
    const res = await withNext(next);
    expect(res.headers.get('location')).toBe(`${SITE}${next}`);
  });

  it.each([
    '@evil.example/x',
    '.evil.example/x',
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example/x',
    '/..//evil.example/x',
  ])('never leaves the site for next=%j', async (next) => {
    const res = await withNext(next);
    expect(res.headers.get('location')).toBe(`${SITE}/dashboard`);
  });

  it('sends an invite to its join page whatever next says', async () => {
    const res = await callback('code=abc&invite=tok%2F1&next=@evil.example');
    expect(res.headers.get('location')).toBe(`${SITE}/join/tok%2F1`);
  });

  it('returns to login when the code exchange fails', async () => {
    exchange.error = new Error('bad code');
    const res = await withNext('@evil.example/x');
    expect(res.headers.get('location')).toBe(
      `${SITE}/login?error=OAuth+authentication+failed`
    );
  });
});
