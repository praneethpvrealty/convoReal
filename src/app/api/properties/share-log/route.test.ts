import { beforeEach, describe, expect, it, vi } from 'vitest';

let ctxRows: Record<string, unknown[]>;
let ledgerCalls: unknown[][];
let ledgerFails: Set<string>;
let role: 'agent' | 'viewer';

function ctxDb() {
  return {
    from(table: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: ctxRows[table]?.[0] ?? null, error: null }),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve({ data: ctxRows[table] ?? [], error: null }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    if (role === 'viewer' && min === 'agent') {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return { supabase: ctxDb(), accountId: 'acc-1', userId: 'user-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: (err as { status?: number })?.status ?? 500 }
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ tag: 'admin' }),
}));

vi.mock('@/lib/whatsapp/share-property-send', () => ({
  logPropertyShare: vi.fn(async (...args: unknown[]) => {
    ledgerCalls.push(args);
    return !ledgerFails.has(args[4] as string);
  }),
}));

const { POST } = await import('./route');

function request(body: unknown) {
  return new Request('http://localhost/api/properties/share-log', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  role = 'agent';
  ledgerCalls = [];
  ledgerFails = new Set();
  ctxRows = {
    properties: [{ id: 'p-1' }],
    contacts: [
      { id: 'c-1', classification: 'Buyer' },
      { id: 'c-2', classification: 'Agent' },
    ],
  };
});

describe('[JRN-009] POST /api/properties/share-log', () => {
  it('records each owned recipient through the server ledger writer, deduplicated', async () => {
    const res = await POST(
      request({
        property_id: 'p-1',
        recipients: [
          { contact_id: 'c-1', classification: 'Buyer' },
          { contact_id: 'c-1', classification: 'Buyer' },
          { contact_id: 'c-2', classification: 'Agent' },
          { contact_id: 'c-stranger' },
        ],
        channel: 'email',
        journey_visible: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ data: { recorded: 2, failed: ['c-stranger'] } });
    expect(ledgerCalls).toEqual([
      [
        { tag: 'admin' },
        'acc-1',
        'user-1',
        'p-1',
        'c-1',
        'Buyer',
        { channel: 'email', journeyVisible: true },
      ],
      [
        { tag: 'admin' },
        'acc-1',
        'user-1',
        'p-1',
        'c-2',
        'Agent',
        { channel: 'email', journeyVisible: true },
      ],
    ]);
  });

  it('classifies each recipient from its contact row, not the request', async () => {
    await POST(
      request({
        property_id: 'p-1',
        recipients: [
          { contact_id: 'c-2' },
          { contact_id: 'c-1', classification: 'Agent' },
        ],
      })
    );
    expect(ledgerCalls.map((call) => [call[4], call[5]])).toEqual([
      ['c-2', 'Agent'],
      ['c-1', 'Buyer'],
    ]);
  });

  it('defaults to a hidden WhatsApp capture', async () => {
    ctxRows.contacts = [{ id: 'c-1' }];
    await POST(
      request({ property_id: 'p-1', recipients: [{ contact_id: 'c-1' }] })
    );
    expect(ledgerCalls[0]?.[5]).toBeNull();
    expect(ledgerCalls[0]?.[6]).toEqual({
      channel: 'whatsapp',
      journeyVisible: false,
    });
  });

  it('counts only the shares the ledger wrote and names the ones it did not', async () => {
    ledgerFails.add('c-2');
    const res = await POST(
      request({
        property_id: 'p-1',
        recipients: [{ contact_id: 'c-1' }, { contact_id: 'c-2' }],
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { recorded: 1, failed: ['c-2'] },
    });
  });

  it('refuses a property outside the account', async () => {
    ctxRows.properties = [];
    const res = await POST(
      request({ property_id: 'p-9', recipients: [{ contact_id: 'c-1' }] })
    );
    expect(res.status).toBe(404);
    expect(ledgerCalls).toEqual([]);
  });

  it('requires a property and at least one recipient', async () => {
    const res = await POST(request({ property_id: 'p-1', recipients: [] }));
    expect(res.status).toBe(400);
  });

  it('is closed to viewers', async () => {
    role = 'viewer';
    const res = await POST(
      request({ property_id: 'p-1', recipients: [{ contact_id: 'c-1' }] })
    );
    expect(res.status).toBe(403);
  });
});
