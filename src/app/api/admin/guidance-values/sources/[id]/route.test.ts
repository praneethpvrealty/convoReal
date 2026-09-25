import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
  deleted: [] as Array<{ storage_path: string }>,
  removed: [] as string[][],
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 403 }),
}));

vi.mock('@/lib/guidance-value/server', () => ({
  GUIDANCE_SOURCE_BUCKET: 'guidance-value-sources',
  requireGuidanceAdmin: async () => ({ userId: 'admin-1' }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        delete: () => builder,
        eq: (column: string, value: unknown) => {
          calls.filters.push(['eq', column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          calls.filters.push(['is', column, value]);
          return builder;
        },
        select: async () => ({ data: calls.deleted, error: null }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          calls.removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

import { DELETE } from './route';

function remove(query = '') {
  return DELETE(
    new Request(`http://test/api/admin/guidance-values/sources/src-1${query}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: 'src-1' }) }
  );
}

describe('DELETE /api/admin/guidance-values/sources/[id]', () => {
  it('[GVL-012] with ?unread=1 only deletes a notification with nothing read and no batch', async () => {
    calls.filters = [];
    calls.deleted = [];
    const res = await remove('?unread=1');
    expect(calls.filters).toEqual([
      ['eq', 'id', 'src-1'],
      ['eq', 'pages_parsed', 0],
      ['is', 'batch_id', null],
    ]);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SOURCE_IN_USE');
  });

  it('deletes unconditionally from the admin screen and removes the PDF', async () => {
    calls.filters = [];
    calls.removed = [];
    calls.deleted = [{ storage_path: 'KA/1-x.pdf' }];
    const res = await remove();
    expect(res.status).toBe(200);
    expect(calls.filters).toEqual([['eq', 'id', 'src-1']]);
    expect(calls.removed).toEqual([['KA/1-x.pdf']]);
  });
});
