import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';

const state = vi.hoisted(() => ({ admin: true }));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: String(err) },
      { status: (err as { status?: number }).status ?? 500 }
    ),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: async () => {
    if (!state.admin)
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    return { userId: 'admin-1' };
  },
}));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => memorySupabase(tables),
}));

import { GET, PATCH } from './route';

const url = 'http://localhost/api/admin/bot-thread-reviews';

beforeEach(() => {
  state.admin = true;
  tables = {
    bot_thread_reviews: [
      { id: 'r-fail', verdict: 'fail', reviewed_at: '2026-10-08T00:00:00Z' },
      { id: 'r-pass', verdict: 'pass', reviewed_at: '2026-10-08T00:00:00Z' },
      {
        id: 'r-unscored',
        verdict: 'unscored',
        reviewed_at: '2026-10-08T00:00:00Z',
      },
    ],
  };
});

describe('[CNV-006] /api/admin/bot-thread-reviews', () => {
  it('is for platform admins only', async () => {
    state.admin = false;
    expect((await GET(new Request(url))).status).toBe(403);
    expect(
      (
        await PATCH(
          new Request(url, { method: 'PATCH', body: JSON.stringify({}) })
        )
      ).status
    ).toBe(403);
  });

  it('lists the threads worth a look by default, and any verdict on request', async () => {
    const attention = (await (await GET(new Request(url))).json()) as {
      reviews: Row[];
    };
    expect(attention.reviews.map((r) => r.id).sort()).toEqual([
      'r-fail',
      'r-unscored',
    ]);
    const passed = (await (
      await GET(new Request(`${url}?verdict=pass`))
    ).json()) as { reviews: Row[] };
    expect(passed.reviews.map((r) => r.id)).toEqual(['r-pass']);
    const all = (await (
      await GET(new Request(`${url}?verdict=all`))
    ).json()) as {
      reviews: Row[];
    };
    expect(all.reviews).toHaveLength(3);
  });

  it('records the platform verdict on a thread and clears it again', async () => {
    const bad = await PATCH(
      new Request(url, {
        method: 'PATCH',
        body: JSON.stringify({
          id: 'r-fail',
          adminVerdict: 'bad',
          adminNote: 'repeats',
        }),
      })
    );
    expect(bad.status).toBe(200);
    expect(tables.bot_thread_reviews[0]).toMatchObject({
      admin_verdict: 'bad',
      admin_note: 'repeats',
    });
    expect(tables.bot_thread_reviews[0].admin_reviewed_at).toBeTruthy();

    const cleared = await PATCH(
      new Request(url, {
        method: 'PATCH',
        body: JSON.stringify({ id: 'r-fail', adminVerdict: null }),
      })
    );
    expect(cleared.status).toBe(200);
    expect(tables.bot_thread_reviews[0].admin_verdict).toBeNull();
    expect(tables.bot_thread_reviews[0].admin_reviewed_at).toBeNull();
  });

  it('rejects an unknown verdict and an unknown thread', async () => {
    expect(
      (
        await PATCH(
          new Request(url, {
            method: 'PATCH',
            body: JSON.stringify({ id: 'r-fail', adminVerdict: 'meh' }),
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await PATCH(
          new Request(url, {
            method: 'PATCH',
            body: JSON.stringify({ id: 'nope', adminVerdict: 'good' }),
          })
        )
      ).status
    ).toBe(404);
  });
});
