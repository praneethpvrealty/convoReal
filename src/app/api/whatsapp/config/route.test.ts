import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ tables: [] as string[], adminTouched: false }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: (table: string) => {
      db.tables.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { account_id: 'acct-1' },
              error: null,
            }),
          }),
        }),
      };
    },
  }),
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
    new Request('http://test/api/whatsapp/config', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('[WAN-007] POST /api/whatsapp/config', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db.tables = [];
    db.adminTouched = false;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['123/../456', '123?fields=id', 'phone-1', 1029384756])(
    'answers 400 for the malformed phone_number_id %j without calling Meta',
    async (phone_number_id) => {
      const res = await post({ phone_number_id, access_token: 'tok' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'Phone Number ID must contain digits only.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.tables).toEqual(['profiles']);
      expect(db.adminTouched).toBe(false);
    }
  );

  it('answers 400 for a malformed waba_id without calling Meta', async () => {
    const res = await post({
      phone_number_id: '1029384756',
      waba_id: 'waba-1',
      access_token: 'tok',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'WhatsApp Business Account ID must contain digits only.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.tables).toEqual(['profiles']);
    expect(db.adminTouched).toBe(false);
  });
});
