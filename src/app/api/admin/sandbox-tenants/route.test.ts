import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: async () => ({ userId: 'admin-1' }),
}));

const db = vi.hoisted(() => ({ touched: false }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    db.touched = true;
    throw new Error('database must not be reached');
  },
}));

import { POST } from './route';

function post(body: unknown) {
  return POST(
    new Request('http://test/api/admin/sandbox-tenants', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('[WAN-007] POST /api/admin/sandbox-tenants', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db.touched = false;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['123/../456', '123?fields=id', 'phone-1'])(
    'answers 400 for the malformed phone_number_id %j without calling Meta',
    async (phone_number_id) => {
      const res = await post({
        tenant_account_ids: ['acct-1'],
        phone_number_id,
        access_token: 'tok',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/phone_number_id.*digits only/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.touched).toBe(false);
    }
  );

  it.each(['5647382910/subscribed_apps', 5647382910, {}, 0, false])(
    'answers 400 for the malformed waba_id %j without calling Meta',
    async (waba_id) => {
      const res = await post({
        tenant_account_ids: ['acct-1'],
        phone_number_id: '1029384756',
        waba_id,
        access_token: 'tok',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/waba_id.*digits only/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.touched).toBe(false);
    }
  );

  it('answers 400 for a phone_number_id that is not a string', async () => {
    const res = await post({
      tenant_account_ids: ['acct-1'],
      phone_number_id: 1029384756,
      access_token: 'tok',
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.touched).toBe(false);
  });
});
