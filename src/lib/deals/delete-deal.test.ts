import { beforeEach, describe, expect, it, vi } from 'vitest';

let lookup: { data: { property_id: string | null } | null; error: unknown };
let deletes: string[];

vi.mock('@/lib/invoices/server', () => ({ DEAL_DOCUMENT_BUCKET: 'deal-docs' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
}));

function fakeDb() {
  return {
    from(table: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        maybeSingle: async () => lookup,
        delete: () => {
          deletes.push(table);
          return builder;
        },
        then: (resolve: unknown) =>
          Promise.resolve({ data: [{ id: 'deal-1' }], error: null }).then(
            resolve as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

const { deleteDealWithCleanup } = await import('./delete-deal');

beforeEach(() => {
  lookup = { data: { property_id: null }, error: null };
  deletes = [];
});

describe('[JRN-011] deleteDealWithCleanup', () => {
  it('reports a failed lookup as a 500, not as a missing deal', async () => {
    lookup = { data: null, error: { message: 'connection reset' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await deleteDealWithCleanup(
      { supabase: fakeDb() as never, accountId: 'acc-1' },
      'deal-1'
    );
    spy.mockRestore();
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(deletes).toEqual([]);
  });

  it('answers 404 for a deal outside the account', async () => {
    lookup = { data: null, error: null };
    const result = await deleteDealWithCleanup(
      { supabase: fakeDb() as never, accountId: 'acc-1' },
      'deal-1'
    );
    expect(result).toEqual({ ok: false, status: 404, error: 'Deal not found' });
    expect(deletes).toEqual([]);
  });

  it('deletes the deal once it is found', async () => {
    const result = await deleteDealWithCleanup(
      { supabase: fakeDb() as never, accountId: 'acc-1' },
      'deal-1'
    );
    expect(result).toEqual({ ok: true });
    expect(deletes).toEqual(['deals']);
  });
});
