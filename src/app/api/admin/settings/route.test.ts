import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: async () => ({ userId: 'admin-1' }),
}));

const tables: Record<string, unknown[]> = {
  system_settings: [],
  whatsapp_config: [],
  profiles: [
    { account_id: 'acct-1', full_name: 'Owner One', email: 'one@test' },
  ],
  accounts: [
    { id: 'acct-1', name: 'One', created_at: '2026-09-01T00:00:00Z' },
    { id: 'acct-2', name: 'Two', created_at: '2026-08-01T00:00:00Z' },
  ],
  subscriptions: [],
};

const rpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
  data: [{ account_id: 'acct-1', last_active_at: '2026-10-14T07:46:36Z' }],
  error: null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc,
    from: (table: string) => {
      const result = { data: tables[table], error: null, count: 0 };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
      };
      return query;
    },
  }),
}));

import { GET } from './route';

describe('[ORG-001] GET /api/admin/settings', () => {
  it('reports each organization’s last active time, null when never seen', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(rpc).toHaveBeenCalledWith('admin_account_last_active');
    expect(
      body.organizations.map(
        (o: { id: string; last_active_at: string | null }) => [
          o.id,
          o.last_active_at,
        ]
      )
    ).toEqual([
      ['acct-1', '2026-10-14T07:46:36Z'],
      ['acct-2', null],
    ]);
  });

  it('leaves last active unset rather than reporting Never when the lookup fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const org of body.organizations) {
      expect(org).not.toHaveProperty('last_active_at');
    }
    errorSpy.mockRestore();
  });
});
