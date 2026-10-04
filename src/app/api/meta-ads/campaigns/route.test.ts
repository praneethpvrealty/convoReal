import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  filters: [] as Array<[string, string, unknown]>,
  insightsCalls: 0,
  insightsError: null as unknown,
  updates: [] as Array<[string, Record<string, unknown>]>,
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  adContactCounts: [] as Array<{ source_id: string; contacts: number }>,
  rpcError: null as unknown,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpcCalls.push([fn, args]);
        return state.rpcError
          ? { data: null, error: state.rpcError }
          : { data: state.adContactCounts, error: null };
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit: async () => ({ allowed: true }),
  gateResponse: () => Response.json({}, { status: 402 }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }));

vi.mock('@/lib/meta-ads/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta-ads/client')>();
  return {
    ...actual,
    getCampaignInsights: async () => {
      state.insightsCalls += 1;
      if (state.insightsError) throw state.insightsError;
      return { spend: 10, impressions: 1, reach: 1, conversationsStarted: 1 };
    },
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const result = () => {
        const data = state.tables[table];
        return {
          data: Array.isArray(data) ? data : (data ?? null),
          error: state.errors[table] ?? null,
        };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        update: (payload: Record<string, unknown>) => {
          state.updates.push([table, payload]);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          state.filters.push([table, column, value]);
          return builder;
        },
        in: () => builder,
        gte: (column: string, value: unknown) => {
          state.filters.push([table, column, value]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));

import { GET } from './route';

const NOW_ISO = new Date().toISOString();

const CAMPAIGN = {
  id: 'camp-1',
  property_id: 'prop-1',
  campaign_id: 'meta-camp-1',
  adset_id: 'adset-1',
  ad_id: 'ad-1',
  status: 'ACTIVE',
  daily_budget_minor: 50000,
  currency: 'USD',
  headline: 'Maple Grove',
  created_at: '2026-10-01T00:00:00Z',
  last_insights: {
    spend: 90,
    impressions: 100,
    reach: 80,
    conversations: 3,
    fetched_at: NOW_ISO,
    window: 'last_30d',
  },
  last_insights_at: NOW_ISO,
};

beforeEach(() => {
  state.tables = {};
  state.errors = {};
  state.filters.length = 0;
  state.insightsCalls = 0;
  state.insightsError = null;
  state.updates.length = 0;
  state.rpcCalls.length = 0;
  state.adContactCounts = [];
  state.rpcError = null;
});

describe('GET /api/meta-ads/campaigns', () => {
  it('[PRP-029] reports not_connected even when there are no campaigns and no config', async () => {
    state.tables = { ad_campaigns: [], meta_ads_config: null };

    const body = await (await GET()).json();

    expect(body.campaigns).toEqual([]);
    expect(body.connection).toEqual({
      status: 'not_connected',
      adAccountId: null,
      pageId: null,
      currency: null,
    });
  });

  it('[PRP-029] always returns the connection, even when no insights need refreshing', async () => {
    state.tables = {
      ad_campaigns: [CAMPAIGN],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'token_expired',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    const body = await (await GET()).json();

    expect(state.insightsCalls).toBe(0);
    expect(body.connection).toEqual({
      status: 'token_expired',
      adAccountId: 'act_1',
      pageId: 'page_1',
      currency: 'USD',
    });
    expect(body.campaigns[0].currency).toBe('USD');
  });

  it('[PRP-029] counts leads per ad in SQL over the same 30-day window and prices the cost per lead on that', async () => {
    state.tables = {
      ad_campaigns: [CAMPAIGN],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };
    state.adContactCounts = [{ source_id: 'ad-1', contacts: 2 }];
    const before = Date.now();

    const body = await (await GET()).json();

    expect(body.campaigns[0].leadsInEngine).toBe(2);
    expect(body.campaigns[0].costPerLeadInr).toBe(45);
    expect(state.rpcCalls).toHaveLength(1);
    const [fn, args] = state.rpcCalls[0];
    expect(fn).toBe('ad_contact_counts');
    expect(args.p_account_id).toBe('acct-1');
    expect(args.p_ad_ids).toEqual(['ad-1']);
    const since = new Date(args.p_since as string).getTime();
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - windowMs - 1000);
    expect(since).toBeLessThanOrEqual(Date.now() - windowMs);
  });

  it('[PRP-029] refetches an archived campaign once when its cache holds lifetime totals', async () => {
    const lifetime = { ...CAMPAIGN.last_insights, spend: 5000 };
    delete (lifetime as { window?: string }).window;
    state.tables = {
      ad_campaigns: [
        { ...CAMPAIGN, status: 'ARCHIVED', last_insights: lifetime },
      ],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    const body = await (await GET()).json();

    expect(state.insightsCalls).toBe(1);
    expect(body.campaigns[0].insights.spend).toBe(10);
  });

  it('[PRP-029] leaves an archived 30-day cache alone', async () => {
    state.tables = {
      ad_campaigns: [{ ...CAMPAIGN, status: 'ARCHIVED' }],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    const body = await (await GET()).json();

    expect(state.insightsCalls).toBe(0);
    expect(body.campaigns[0].insights.spend).toBe(90);
  });

  it('[PRP-029] never labels lifetime totals as the last 30 days when the refetch fails', async () => {
    const lifetime = { ...CAMPAIGN.last_insights, spend: 5000 };
    delete (lifetime as { window?: string }).window;
    state.tables = {
      ad_campaigns: [
        { ...CAMPAIGN, status: 'ARCHIVED', last_insights: lifetime },
      ],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };
    state.insightsError = new Error('campaign deleted');

    const body = await (await GET()).json();

    expect(state.insightsCalls).toBe(1);
    expect(body.campaigns[0].insights).toBeNull();
  });

  it('[PRP-029] refetches at most five archived lifetime caches per load', async () => {
    const lifetime = { ...CAMPAIGN.last_insights, spend: 5000 };
    delete (lifetime as { window?: string }).window;
    state.tables = {
      ad_campaigns: Array.from({ length: 7 }, (_, i) => ({
        ...CAMPAIGN,
        id: `camp-${i}`,
        status: 'ARCHIVED',
        last_insights: lifetime,
      })),
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    const body = await (await GET()).json();

    expect(state.insightsCalls).toBe(5);
    expect(
      body.campaigns.filter((c: { insights: unknown }) => c.insights === null)
    ).toHaveLength(2);
  });

  it('[PRP-029] drops a lifetime cache whose refetch fails, so it is tried once', async () => {
    const lifetime = { ...CAMPAIGN.last_insights, spend: 5000 };
    delete (lifetime as { window?: string }).window;
    state.tables = {
      ad_campaigns: [
        { ...CAMPAIGN, status: 'ARCHIVED', last_insights: lifetime },
      ],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };
    state.insightsError = new Error('campaign deleted');

    await GET();

    expect(state.updates).toContainEqual([
      'ad_campaigns',
      { last_insights: null },
    ]);
  });

  it('[PRP-029] never refetches an archived campaign with nothing cached', async () => {
    state.tables = {
      ad_campaigns: [{ ...CAMPAIGN, status: 'ARCHIVED', last_insights: null }],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    await GET();

    expect(state.insightsCalls).toBe(0);
  });

  it('[PRP-029] fails the load instead of reporting zero leads when the lead count errors', async () => {
    state.tables = {
      ad_campaigns: [CAMPAIGN],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      meta_ads_config: null,
    };
    state.rpcError = { message: 'boom' };

    const res = await GET();

    expect(res.status).toBe(500);
  });

  it('[PRP-029] fails the load instead of reporting not_connected when the config read errors', async () => {
    state.tables = { ad_campaigns: [], meta_ads_config: null };
    state.errors = { meta_ads_config: { message: 'timeout' } };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to load campaigns');
    expect(body.connection).toBeUndefined();
  });
});
