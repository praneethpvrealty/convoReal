import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  betaInvite: null as Record<string, unknown> | null,
  accountInvitation: null as Record<string, unknown> | null,
  seatsTaken: 5,
  accountCap: 100,
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string) =>
      fn === 'hash_beta_token'
        ? { data: 'hashed', error: null }
        : { data: state.seatsTaken, error: null },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'beta_invites'
                ? state.betaInvite
                : state.accountInvitation,
            error: null,
          }),
        }),
        maybeSingle: async () => ({
          data: { account_cap: state.accountCap },
          error: null,
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response('limited', { status: 429 }),
}));

const { POST } = await import('./route');

const ask = async (body: Record<string, unknown>) => {
  const response = await POST(
    new Request('http://localhost/api/public/signup-eligibility', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  );
  return (await response.json()).data.reason;
};

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  state.betaInvite = null;
  state.accountInvitation = null;
  state.seatsTaken = 5;
  state.accountCap = 100;
});

describe('POST /api/public/signup-eligibility', () => {
  it('names a missing invite', async () => {
    expect(await ask({})).toBe('no_invite');
  });

  it('names a token that matches nothing', async () => {
    expect(await ask({ betaToken: 'nope' })).toBe('invalid_token');
  });

  it('tells expired, claimed and revoked apart', async () => {
    state.betaInvite = { status: 'pending', expires_at: past };
    expect(await ask({ betaToken: 't' })).toBe('expired');

    state.betaInvite = { status: 'accepted', expires_at: future };
    expect(await ask({ betaToken: 't' })).toBe('claimed');

    state.betaInvite = { status: 'revoked', expires_at: future };
    expect(await ask({ betaToken: 't' })).toBe('revoked');
  });

  it('reports a full beta before blaming the invite', async () => {
    state.betaInvite = { status: 'pending', expires_at: future };
    state.seatsTaken = 100;
    expect(await ask({ betaToken: 't' })).toBe('seats_full');
  });

  it('says eligible when the gate would have allowed it', async () => {
    state.betaInvite = { status: 'pending', expires_at: future };
    expect(await ask({ betaToken: 't' })).toBe('eligible');
  });

  it('accepts a live team invite on its own', async () => {
    state.accountInvitation = { accepted_at: null, expires_at: future };
    expect(await ask({ teamToken: 't' })).toBe('eligible');

    state.accountInvitation = { accepted_at: future, expires_at: future };
    expect(await ask({ teamToken: 't' })).toBe('claimed');
  });
});
