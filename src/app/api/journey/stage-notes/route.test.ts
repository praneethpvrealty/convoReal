import { beforeEach, describe, expect, it, vi } from 'vitest';

let itemRow: { id: string; stage_id: string } | null;
let stageLookups: unknown[];
let inserted: Record<string, unknown>[];

function table(name: string) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: () => chain,
    eq: (column: unknown, value: unknown) => {
      filters[String(column)] = value;
      return chain;
    },
    maybeSingle: async () => {
      if (name === 'journey_items') return { data: itemRow, error: null };
      if (name === 'journey_stages') {
        stageLookups.push(filters.id);
        return {
          data: {
            id: filters.id,
            name: `Stage ${filters.id}`,
            color: '#22c55e',
          },
          error: null,
        };
      }
      return { data: { full_name: 'Asha' }, error: null };
    },
    insert: (row: unknown) => {
      inserted.push(row as Record<string, unknown>);
      return chain;
    },
    single: async () => ({ data: inserted.at(-1), error: null }),
  };
  return chain;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: { from: (name: string) => table(name) },
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
    itemRow = { id: 'item-1', stage_id: 'visit' };
    stageLookups = [];
    inserted = [];
  });

  it('[JRN-004] tags the note with the stage the item is at now, not the one the client sent', async () => {
    const res = await post({
      item_id: 'item-1',
      stage_id: 'enquiry',
      note: 'Token paid',
    });
    expect(res.status).toBe(200);
    expect(stageLookups).toEqual(['visit']);
    expect(inserted[0]).toMatchObject({
      account_id: 'acc-1',
      item_id: 'item-1',
      stage_id: 'visit',
      stage_name: 'Stage visit',
      stage_color: '#22c55e',
      note: 'Token paid',
      created_by_name: 'Asha',
    });
  });

  it('[JRN-004] refuses an item outside the account', async () => {
    itemRow = null;
    const res = await post({ item_id: 'item-9', note: 'x' });
    expect(res.status).toBe(404);
    expect(inserted).toEqual([]);
  });
});
