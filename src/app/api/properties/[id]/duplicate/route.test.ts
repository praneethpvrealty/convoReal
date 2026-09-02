import { beforeEach, describe, expect, it, vi } from 'vitest';

const state: {
  source: Record<string, unknown> | null;
  inserted: Record<string, unknown> | null;
  accountFilters: Array<[string, unknown]>;
} = { source: null, inserted: null, accountFilters: [] };

function propertiesQuery() {
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      state.accountFilters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({ data: state.source, error: null }),
    insert: (values: Record<string, unknown>) => {
      state.inserted = values;
      return {
        select: () => ({
          single: async () => ({
            data: { id: 'prop-2', ...values },
            error: null,
          }),
        }),
      };
    },
  };
  return query;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'account-1',
    role: 'agent',
    userId: 'user-1',
    supabase: { from: () => propertiesQuery() },
  }),
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 1000 } },
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit: async () => ({ allowed: true }),
  gateResponse: () => Response.json({ error: 'upgrade' }, { status: 402 }),
}));

import { POST } from './route';

beforeEach(() => {
  state.source = null;
  state.inserted = null;
  state.accountFilters = [];
});

function call() {
  return POST(
    new Request('http://test/api/properties/prop-1/duplicate', {
      method: 'POST',
    }),
    {
      params: Promise.resolve({ id: 'prop-1' }),
    }
  );
}

describe('POST /api/properties/[id]/duplicate', () => {
  it('copies the details without the media and scopes the lookup to the account', async () => {
    state.source = {
      id: 'prop-1',
      account_id: 'account-1',
      title: 'Prestige Lakeside — Unit 402',
      location: 'Whitefield',
      type: 'Apartment',
      price: 12000000,
      status: 'Sold',
      is_published: true,
      images: ['a.jpg'],
      documents: ['deed.pdf'],
      video_url: 'video.mp4',
      property_code: 'PROP-1001',
    };

    const response = await call();

    expect(response.status).toBe(201);
    expect(state.accountFilters).toContainEqual(['account_id', 'account-1']);
    expect(state.inserted).toMatchObject({
      account_id: 'account-1',
      user_id: 'user-1',
      title: 'Prestige Lakeside — Unit 402 (Copy)',
      location: 'Whitefield',
      status: 'Available',
      is_published: false,
      images: [],
      documents: [],
    });
    expect(state.inserted).not.toHaveProperty('video_url');
    expect(state.inserted).not.toHaveProperty('property_code');
  });

  it('404s when the listing is not in the account', async () => {
    const response = await call();

    expect(response.status).toBe(404);
    expect(state.inserted).toBeNull();
  });
});
