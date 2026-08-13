import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/properties/bulk-tags — tag a whole project in one action.
 * The merge itself lives in SQL (bulk_tag_properties, migration 266);
 * the route's job is to refuse a request that would do something the
 * caller did not mean, and to report what actually changed.
 */

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let rpcResult: { data?: unknown; error?: unknown };

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://test/api/properties/bulk-tags', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  rpcCalls = [];
  rpcResult = { data: [{ id: 'p-1', tags: ['APM'] }] };
});

describe('POST /api/properties/bulk-tags', () => {
  it('names the caller account and passes the tags through', async () => {
    rpcResult = {
      data: [
        { id: 'p-1', tags: ['APM'] },
        { id: 'p-2', tags: ['APM'] },
      ],
    };

    const res = await POST(req({ propertyIds: ['p-1', 'p-2'], add: ['APM'] }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      updated: 2,
      requested: 2,
      add: ['APM'],
    });
    expect(rpcCalls[0]).toEqual({
      name: 'bulk_tag_properties',
      args: {
        target_account_id: 'acc-1',
        property_ids: ['p-1', 'p-2'],
        add_tags: ['APM'],
        remove_tags: [],
      },
    });
  });

  it('trims and de-duplicates the tags before they reach SQL', async () => {
    await POST(req({ propertyIds: ['p-1'], add: ['  APM  ', 'APM', ''] }));
    expect(rpcCalls[0].args.add_tags).toEqual(['APM']);
  });

  it('reports what changed, not what was asked for', async () => {
    // A selection reaching across tenants comes back short: the function
    // scopes by account rather than erroring.
    rpcResult = { data: [{ id: 'p-1', tags: ['APM'] }] };
    const res = await POST(
      req({ propertyIds: ['p-1', 'p-elsewhere'], add: ['APM'] })
    );
    expect((await res.json()).data).toMatchObject({ updated: 1, requested: 2 });
  });

  it('refuses a request with nothing selected or nothing to do', async () => {
    expect((await POST(req({ propertyIds: [], add: ['APM'] }))).status).toBe(
      400
    );
    expect((await POST(req({ propertyIds: ['p-1'] }))).status).toBe(400);
    expect(
      (await POST(req({ propertyIds: ['p-1'], add: ['  '], remove: [] })))
        .status
    ).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('caps the selection so the whole inventory cannot be retagged by accident', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `p-${i}`);
    const res = await POST(req({ propertyIds: many, add: ['APM'] }));
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});
