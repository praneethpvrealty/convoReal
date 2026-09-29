import { beforeEach, describe, expect, it, vi } from 'vitest';

let calls: { fn: string; args: Record<string, unknown> }[];
let result: { data: unknown; error: unknown };

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const chain = {
          select: () => chain,
          maybeSingle: async () => result,
        };
        return chain;
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: (err as Error).message }, { status: 500 }),
}));

const { POST } = await import('./route');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/journey/stage-notes', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/journey/stage-notes', () => {
  beforeEach(() => {
    calls = [];
    result = {
      data: { id: 'n1', stage_id: 'visit', stage_name: 'Visit' },
      error: null,
    };
  });

  it('[JRN-004] saves through one database call that resolves the current stage, ignoring any client stage', async () => {
    const res = await post({
      item_id: 'item-1',
      stage_id: 'enquiry',
      note: '  Token paid ',
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        fn: 'add_journey_item_note',
        args: {
          p_account_id: 'acc-1',
          p_item_id: 'item-1',
          p_note: 'Token paid',
        },
      },
    ]);
    expect((await res.json()).data.stage_id).toBe('visit');
  });

  it('[JRN-004] reports an item outside the account as not found', async () => {
    result = { data: null, error: null };
    const res = await post({ item_id: 'item-9', note: 'x' });
    expect(res.status).toBe(404);
  });

  it('[JRN-004] rejects a blank note before touching the database', async () => {
    const res = await post({ item_id: 'item-1', note: '   ' });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
