import { beforeEach, describe, expect, it, vi } from 'vitest';

let rows: {
  journey_items: Array<{ id: string }>;
  deals: Array<{ id: string }>;
};
let deletedItems: string[][];
let deletedDeals: string[];
let deleteResult:
  { ok: true } | { ok: false; status: 404 | 500; error: string };
let readOnly: boolean;

function ctxDb() {
  return {
    from(table: 'journey_items' | 'deals') {
      const state: { deleting: boolean; ids: string[] } = {
        deleting: false,
        ids: [],
      };
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: () => builder,
        in: (_col: unknown, ids: unknown) => {
          state.ids = ids as string[];
          return builder;
        },
        delete: () => {
          state.deleting = true;
          return builder;
        },
        then: (resolve: unknown, reject: unknown) => {
          if (state.deleting) deletedItems.push(state.ids);
          return Promise.resolve({ data: rows[table], error: null }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          );
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async () => {
    if (readOnly) {
      throw Object.assign(new Error('Read-only members cannot make changes.'), {
        status: 403,
      });
    }
    return { supabase: ctxDb(), accountId: 'acc-1', userId: 'user-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: (err as { status?: number })?.status ?? 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/deals/delete-deal', () => ({
  deleteDealWithCleanup: vi.fn(async (_ctx: unknown, dealId: string) => {
    deletedDeals.push(dealId);
    return deleteResult;
  }),
}));

const { POST, parseRemoveInput } = await import('./route');

function request(body: unknown) {
  return new Request('http://localhost/api/journey/remove', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  rows = { journey_items: [{ id: 'item-1' }], deals: [{ id: 'deal-1' }] };
  deletedItems = [];
  deletedDeals = [];
  deleteResult = { ok: true };
  readOnly = false;
});

describe('[JRN-011] POST /api/journey/remove', () => {
  it('removes the branch first, then deletes the deal opened from it with cleanup', async () => {
    const res = await POST(request({ item_ids: ['item-1', 'item-1'] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ data: { items: 1, deals: 1 } });
    expect(deletedItems).toEqual([['item-1']]);
    expect(deletedDeals).toEqual(['deal-1']);
  });

  it('removes a whole journey by subject', async () => {
    rows = {
      journey_items: [{ id: 'item-1' }, { id: 'item-2' }],
      deals: [],
    };
    const res = await POST(request({ mode: 'buyer', subject_id: 'contact-1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { items: 2, deals: 0 } });
    expect(deletedDeals).toEqual([]);
  });

  it('reports a deal it could not delete instead of hiding it', async () => {
    deleteResult = { ok: false, status: 500, error: 'documents unreadable' };
    const res = await POST(request({ item_ids: ['item-1'] }));
    expect(await res.json()).toEqual({
      data: { items: 1, deals: 0, failed_deals: ['deal-1'] },
    });
  });

  it('answers 404 when nothing matched in the account', async () => {
    rows = { journey_items: [], deals: [] };
    const res = await POST(request({ item_ids: ['stranger'] }));
    expect(res.status).toBe(404);
    expect(deletedDeals).toEqual([]);
  });

  it('is closed to read-only members and rejects an empty body', async () => {
    readOnly = true;
    expect((await POST(request({ item_ids: ['item-1'] }))).status).toBe(403);
    readOnly = false;
    expect((await POST(request({}))).status).toBe(400);
  });

  it('parses ids or a subject, never both halves missing', () => {
    expect(parseRemoveInput({ item_ids: [' a ', 'a', 3] })).toEqual({
      ok: true,
      value: { kind: 'items', itemIds: ['a'] },
    });
    expect(parseRemoveInput({ mode: 'property', subject_id: 'p-1' })).toEqual({
      ok: true,
      value: { kind: 'subject', mode: 'property', subjectId: 'p-1' },
    });
    expect(parseRemoveInput({ mode: 'seller', subject_id: 'p-1' }).ok).toBe(
      false
    );
    expect(parseRemoveInput({ item_ids: [] }).ok).toBe(false);
  });
});
