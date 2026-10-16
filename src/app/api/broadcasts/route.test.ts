import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The composer sends a message, not a template: the route carries it on
 * the account's shared broadcast template, greeting each recipient by
 * name and signing with the agency, and refuses with the reason while
 * that template is missing, pending or rejected. Audience resolution,
 * the dispatcher and the database are stubbed.
 */

let inserted: Array<{ table: string; row: Record<string, unknown> }>;
let carrierState: {
  status: string | null;
  template: Record<string, unknown> | null;
  rejectionReason: string | null;
  setupError: string | null;
};

function makeAdmin() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        insert: (row: unknown) => {
          const rows = Array.isArray(row) ? row : [row];
          for (const r of rows) {
            inserted.push({ table, row: r as Record<string, unknown> });
          }
          return builder;
        },
        update: () => builder,
        eq: () => builder,
        select: () => builder,
        single: () =>
          Promise.resolve({
            data: { id: 'bcast-1', ...inserted[inserted.length - 1]?.row },
            error: null,
          }),
        then: (resolve: unknown) =>
          Promise.resolve({ data: null, error: null }).then(
            resolve as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {},
    accountId: 'acc-1',
    userId: 'user-1',
    account: { id: 'acc-1', name: 'Skyline Realty', defaultLanguage: 'en' },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  RATE_LIMITS: { broadcast: { limit: 10, windowMs: 60_000 } },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => makeAdmin(),
}));

vi.mock('@/lib/broadcasts/sender', () => ({
  resolveAudienceOnServer: async () => [{ id: 'c-1' }, { id: 'c-2' }],
  sendBroadcastRecipients: async () => undefined,
}));

vi.mock('@/lib/whatsapp/broadcast-update-template', () => ({
  ensureBroadcastUpdateTemplate: async () => carrierState,
}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const approvedCarrier = {
  id: 't-1',
  name: 'agency_update_notice',
  language: 'en_US',
  status: 'APPROVED',
  body_text: 'Hello {{1}}, here is an update from {{2}}:\n\n{{3}}',
};

beforeEach(() => {
  inserted = [];
  carrierState = {
    status: 'APPROVED',
    template: approvedCarrier,
    rejectionReason: null,
    setupError: null,
  };
});

describe('POST /api/broadcasts with a composed message', () => {
  it('[BRC-001] carries the message on the shared template with the name, agency and message filled in', async () => {
    const res = await POST(
      request({
        name: 'Weekend site visits',
        message: 'Site visits at Lakeview\nopen this weekend.',
        audience: { type: 'all' },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.broadcastId).toBe('bcast-1');
    expect(json.recipientsCount).toBe(2);

    const broadcast = inserted.find((i) => i.table === 'broadcasts')?.row;
    expect(broadcast).toMatchObject({
      account_id: 'acc-1',
      name: 'Weekend site visits',
      template_name: 'agency_update_notice',
      template_language: 'en_US',
      template_variables: {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'static', value: 'Skyline Realty' },
        '3': {
          type: 'static',
          value: 'Site visits at Lakeview open this weekend.',
        },
      },
      total_recipients: 2,
    });
    expect(
      inserted.filter((i) => i.table === 'broadcast_recipients')
    ).toHaveLength(2);
  });

  it('[BRC-001] refuses a blank message before touching the template or the audience', async () => {
    const res = await POST(
      request({ name: 'Blank', message: '  \n ', audience: { type: 'all' } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Write the message before sending.');
    expect(inserted).toHaveLength(0);
  });

  it('[BRC-002] holds the send with the reason while Meta is still reviewing the template', async () => {
    carrierState = {
      status: 'PENDING',
      template: null,
      rejectionReason: null,
      setupError: null,
    };
    const res = await POST(
      request({ name: 'Hold', message: 'Hello', audience: { type: 'all' } })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('TEMPLATE_PENDING');
    expect(json.error).toMatch(/reviewing/);
    expect(inserted).toHaveLength(0);
  });

  it('[BRC-002] names a rejection and a missing WhatsApp connection as what they are', async () => {
    carrierState = {
      status: 'REJECTED',
      template: null,
      rejectionReason: 'Too promotional',
      setupError: null,
    };
    let res = await POST(
      request({ name: 'Hold', message: 'Hello', audience: { type: 'all' } })
    );
    expect(res.status).toBe(409);
    let json = await res.json();
    expect(json.code).toBe('TEMPLATE_REJECTED');
    expect(json.error).toContain('Too promotional');

    carrierState = {
      status: null,
      template: null,
      rejectionReason: null,
      setupError: 'whatsapp_not_connected',
    };
    res = await POST(
      request({ name: 'Hold', message: 'Hello', audience: { type: 'all' } })
    );
    expect(res.status).toBe(400);
    json = await res.json();
    expect(json.code).toBe('TEMPLATE_UNAVAILABLE');
    expect(json.error).toMatch(/Connect WhatsApp in Settings/);
    expect(inserted).toHaveLength(0);
  });

  it('still accepts the template + variables shape from app builds that predate the composer', async () => {
    const res = await POST(
      request({
        name: 'Legacy',
        template: { name: 'summer_offer', language: 'en_US' },
        variables: { '1': { type: 'field', value: 'name' } },
        audience: { type: 'all' },
      })
    );
    expect(res.status).toBe(200);
    const broadcast = inserted.find((i) => i.table === 'broadcasts')?.row;
    expect(broadcast).toMatchObject({
      template_name: 'summer_offer',
      template_variables: { '1': { type: 'field', value: 'name' } },
    });
  });

  it('rejects a body with neither a message nor a template', async () => {
    const res = await POST(request({ name: 'x', audience: { type: 'all' } }));
    expect(res.status).toBe(400);
  });
});
