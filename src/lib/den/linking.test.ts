import { beforeEach, describe, expect, it, vi } from 'vitest';

let existing: { id: string; display_name: string | null } | null;
let inserts: Record<string, unknown>[];
let updates: Record<string, unknown>[];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => (inserts.push(row), builder),
        update: (row: Record<string, unknown>) => (updates.push(row), builder),
        maybeSingle: async () => ({
          data: table === 'den_users' ? existing : null,
          error: null,
        }),
        single: async () => ({ data: { id: 'den-new' }, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

const { completeDenAuth } = await import('./linking');

beforeEach(() => {
  existing = null;
  inserts = [];
  updates = [];
});

describe('completeDenAuth referral source', () => {
  it('[PVL-006] records the partner link when the owner is created', async () => {
    const result = await completeDenAuth({
      authUserId: 'u1',
      phone: '+919900277111',
      referralSource: 'INDmoney',
    });
    expect(result.isNewDenUser).toBe(true);
    expect(inserts[0]).toMatchObject({ referral_source: 'indmoney' });
  });

  it('[PVL-006] stores nothing for a malformed source', async () => {
    await completeDenAuth({
      authUserId: 'u1',
      phone: '+919900277111',
      referralSource: 'not a slug!',
    });
    expect(inserts[0]).toMatchObject({ referral_source: null });
  });

  it('[PVL-006] never rewrites the source of an owner who already exists', async () => {
    existing = { id: 'den-1', display_name: 'Asha' };
    await completeDenAuth({
      authUserId: 'u1',
      phone: '+919900277111',
      referralSource: 'another-partner',
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty('referral_source');
  });
});
