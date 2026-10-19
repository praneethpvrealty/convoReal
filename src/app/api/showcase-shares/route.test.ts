import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A share instance records the listings a search-results or hand-picked
 * share opens (PRP-005), so the link can carry ?s=<token> instead of
 * every property code. A plain mint stores no pins; a malformed list is
 * refused before anything is written.
 */

let inserts: Array<Record<string, unknown>>;

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'share-1' }, error: null }),
            }),
          };
        },
      }),
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

const { POST } = await import('./route');

function request(body?: unknown) {
  return new Request('http://localhost/api/showcase-shares', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  inserts = [];
});

describe('POST /api/showcase-shares', () => {
  it('mints a plain tracking token when no listings are pinned', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 'share-1' } });
    expect(inserts).toEqual([
      { account_id: 'acc-1', user_id: 'user-1', pinned_ids: null },
    ]);
  });

  it('[PRP-005] records the pinned listings in display order', async () => {
    const res = await POST(request({ ids: [' PROP-2263 ', 'PROP-2249'] }));
    expect(res.status).toBe(200);
    expect(inserts[0].pinned_ids).toEqual(['PROP-2263', 'PROP-2249']);
  });

  it('refuses a malformed list without writing', async () => {
    for (const ids of [
      'PROP-1',
      [1, 2],
      ['PROP-1,PROP-2'],
      [''],
      Array.from({ length: 501 }, (_, i) => `PROP-${i}`),
    ]) {
      const res = await POST(request({ ids }));
      expect(res.status).toBe(400);
    }
    expect(inserts).toEqual([]);
  });
});
