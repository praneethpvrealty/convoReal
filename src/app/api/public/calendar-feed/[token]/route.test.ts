import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFeedToken } from '@/lib/calendar/feed-token';

const TOKEN = `cvr_cal_${'b'.repeat(43)}`;

const state = vi.hoisted(() => ({
  feed: null as null | Record<string, unknown>,
  profile: null as null | Record<string, unknown>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({
    success: true,
    remaining: 1,
    reset: 0,
    limit: 1,
  }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { publicCalendarFeed: {}, publicCalendarFeedIp: {} },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const query = { table, filters: [] as Array<[string, unknown]> };
      state.queries.push(query);
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => (column: string, value?: unknown) => {
        query.filters.push([`${op}:${column}`, value]);
        return builder;
      };
      Object.assign(builder, {
        select: () => builder,
        eq: chain('eq'),
        neq: chain('neq'),
        gte: chain('gte'),
        lte: chain('lte'),
        or: (expr: string) => {
          query.filters.push(['or', expr]);
          return builder;
        },
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
        maybeSingle: async () => {
          if (table === 'calendar_feed_tokens') {
            const hash = query.filters.find(
              ([k]) => k === 'eq:token_hash'
            )?.[1];
            return {
              data:
                state.feed && hash === state.feed.token_hash
                  ? state.feed
                  : null,
              error: null,
            };
          }
          return { data: state.profile, error: null };
        },
      });
      return builder;
    },
  }),
}));

import { GET } from './route';

function get(token: string) {
  return GET(
    new Request(`https://app.test/api/public/calendar-feed/${token}`),
    {
      params: Promise.resolve({ token }),
    }
  );
}

beforeEach(() => {
  state.queries = [];
  state.updates = [];
  state.feed = {
    id: 'feed-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    last_used_at: null,
    token_hash: hashFeedToken(TOKEN),
  };
  state.profile = {
    account_id: 'acct-1',
    account: { name: 'Acme Realty', status: 'active' },
  };
});

describe('[CAL-014] public calendar feed route', () => {
  it("[CAL-014] serves the owner's items only, scoped to their account", async () => {
    const res = await get(`${TOKEN}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('X-WR-CALNAME:ConvoReal · Acme Realty');
    for (const table of ['appointments', 'todos']) {
      const q = state.queries.find((query) => query.table === table)!;
      expect(q.filters).toContainEqual(['eq:account_id', 'acct-1']);
      expect(q.filters).toContainEqual([
        'or',
        'assigned_to.eq.user-1,and(assigned_to.is.null,user_id.eq.user-1)',
      ]);
    }
    expect(state.updates).toHaveLength(1);
  });

  it('[CAL-014] answers 404 for an unknown or malformed token', async () => {
    expect((await get(`cvr_cal_${'c'.repeat(43)}.ics`)).status).toBe(404);
    expect((await get('nonsense')).status).toBe(404);
    expect(state.queries.some((q) => q.table === 'appointments')).toBe(false);
  });

  it('[CAL-014] answers 404 once the user has left the account or it is archived', async () => {
    state.profile = null;
    expect((await get(TOKEN)).status).toBe(404);
    state.profile = {
      account_id: 'acct-1',
      account: { name: 'Acme', status: 'archived' },
    };
    expect((await get(TOKEN)).status).toBe(404);
    expect(state.queries.some((q) => q.table === 'appointments')).toBe(false);
  });
});
