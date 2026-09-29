import { beforeEach, describe, expect, it, vi } from 'vitest';

let updates: Record<string, unknown>[];

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({}),
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {
      from: () => {
        const chain: Record<string, (...args: unknown[]) => unknown> = {
          update: (patch: unknown) => {
            updates.push(patch as Record<string, unknown>);
            return chain;
          },
          eq: () => chain,
          select: () => chain,
          single: async () => ({
            data: { id: 'acc-1', ...updates.at(-1) },
            error: null,
          }),
        };
        return chain;
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: (err as Error).message }, { status: 500 }),
}));

const { PATCH } = await import('./route');

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/account', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );
}

describe('PATCH /api/account journey compartment scope', () => {
  beforeEach(() => {
    updates = [];
  });

  it('[JRN-014] lets an admin share the Focus list or give each agent their own', async () => {
    const res = await patch({ journey_compartment_scope: 'agent' });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ journey_compartment_scope: 'agent' }]);
  });

  it('[JRN-014] rejects an unknown scope without saving', async () => {
    const res = await patch({ journey_compartment_scope: 'everyone' });
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });
});
