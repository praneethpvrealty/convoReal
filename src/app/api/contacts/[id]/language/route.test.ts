import { beforeEach, describe, expect, it, vi } from 'vitest';

let updates: Array<{
  row: Record<string, unknown>;
  filters: [string, unknown][];
}>;
let result: { data: unknown; error: unknown };

function makeDb() {
  return {
    from() {
      const filters: [string, unknown][] = [];
      let row: Record<string, unknown> = {};
      const builder = {
        update(next: Record<string, unknown>) {
          row = next;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          updates.push({ row, filters });
          return Promise.resolve(result);
        },
      };
      return builder;
    },
  };
}

let readOnly = false;

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async () => {
    if (readOnly) throw new Error('Read-only members cannot make changes.');
    return {
      supabase: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

import { PATCH } from './route';

function makeRequest(body: unknown) {
  return new Request('http://test/api/contacts/c-1/language', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'c-1' });

beforeEach(() => {
  updates = [];
  readOnly = false;
  result = { data: { id: 'c-1', preferred_language: 'ta' }, error: null };
});

describe('PATCH /api/contacts/[id]/language', () => {
  it('[CLG-002] writes a supported code scoped to the account', async () => {
    const res = await PATCH(
      makeRequest({ preferred_language: 'ta' }) as never,
      {
        params,
      }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: 'c-1', preferred_language: 'ta' },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].row.preferred_language).toBe('ta');
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ['id', 'c-1'],
        ['account_id', 'acc-1'],
      ])
    );
  });

  it('[CLG-002] clears the preference back to the account default with null', async () => {
    result = { data: { id: 'c-1', preferred_language: null }, error: null };
    const res = await PATCH(
      makeRequest({ preferred_language: null }) as never,
      { params }
    );
    expect(res.status).toBe(200);
    expect(updates[0].row.preferred_language).toBeNull();
  });

  it('[CLG-002] rejects a language the product does not speak', async () => {
    const res = await PATCH(
      makeRequest({ preferred_language: 'fr' }) as never,
      {
        params,
      }
    );
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it('rejects a body without the field', async () => {
    const res = await PATCH(makeRequest({}) as never, { params });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it('[CLG-002] refuses a read-only member before touching the row', async () => {
    readOnly = true;
    const res = await PATCH(
      makeRequest({ preferred_language: 'hi' }) as never,
      {
        params,
      }
    );
    expect(res.status).toBe(500);
    expect(updates).toHaveLength(0);
  });

  it('reports a contact outside the account as not found', async () => {
    result = { data: null, error: null };
    const res = await PATCH(
      makeRequest({ preferred_language: 'hi' }) as never,
      {
        params,
      }
    );
    expect(res.status).toBe(404);
  });
});
