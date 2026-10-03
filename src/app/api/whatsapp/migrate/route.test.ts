import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ adminTouched: false }));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { integration_type: 'sandbox', sandbox_code: 'ABC123' },
              error: null,
            }),
          }),
        }),
      }),
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    db.adminTouched = true;
    throw new Error('database must not be reached');
  },
}));

import { POST } from './route';

function post(body: unknown) {
  return POST(
    new Request('http://test/api/whatsapp/migrate', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('[WAN-007] POST /api/whatsapp/migrate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db.adminTouched = false;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['123/../456', '123?fields=id', 'phone-1'])(
    'answers 400 for the malformed phone_number_id %j without calling Meta',
    async (phone_number_id) => {
      const res = await post({ phone_number_id, access_token: 'tok' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'Phone Number ID must contain digits only.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.adminTouched).toBe(false);
    }
  );

  it.each(['5647382910/subscribed_apps', 5647382910, {}, 0, false])(
    'answers 400 for the malformed waba_id %j without calling Meta',
    async (waba_id) => {
      const res = await post({
        phone_number_id: ' 1029384756 ',
        waba_id,
        access_token: 'tok',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'WhatsApp Business Account ID must contain digits only.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.adminTouched).toBe(false);
    }
  );

  it('answers 400 for a phone_number_id that is not a string', async () => {
    const res = await post({
      phone_number_id: 1029384756,
      access_token: 'tok',
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.adminTouched).toBe(false);
  });
});
