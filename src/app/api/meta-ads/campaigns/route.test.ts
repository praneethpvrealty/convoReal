import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  filters: [] as Array<[string, string, unknown]>,
  insightsCalls: 0,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acct-1', userId: 'user-1' }),
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
          error: null,
        };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        update: () => builder,
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
  },
  last_insights_at: NOW_ISO,
};

beforeEach(() => {
  state.tables = {};
  state.filters.length = 0;
  state.insightsCalls = 0;
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
      ctwa_referrals: [],
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

  it('[PRP-029] counts a contact who tapped the ad twice as one lead and prices the cost per lead on that', async () => {
    state.tables = {
      ad_campaigns: [CAMPAIGN],
      properties: [{ id: 'prop-1', title: 'Maple Grove', images: [] }],
      ctwa_referrals: [
        { source_id: 'ad-1', contact_id: 'c-1' },
        { source_id: 'ad-1', contact_id: 'c-1' },
        { source_id: 'ad-1', contact_id: 'c-2' },
      ],
      meta_ads_config: {
        status: 'connected',
        access_token: 'enc',
        ad_account_id: 'act_1',
        page_id: 'page_1',
        currency: 'USD',
      },
    };

    const body = await (await GET()).json();

    expect(body.campaigns[0].leadsInEngine).toBe(2);
    expect(body.campaigns[0].costPerLeadInr).toBe(45);
    expect(
      state.filters.some(
        ([t, c]) => t === 'ctwa_referrals' && c === 'created_at'
      )
    ).toBe(true);
  });
});
