import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Channel selection for the single-contact property share: free-form
 * inside the 24-hour window, the pre-approved `new_property_alert`
 * template outside it, and a structured "unsent + template status"
 * result only when the window is closed AND the template isn't
 * approved. Meta I/O (dispatcher) and both Supabase clients are
 * stubbed; the params/truncation helpers run for real.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
  count?: number;
}

let ctxQueues: Record<string, QueuedResponse[]>;
let adminQueues: Record<string, QueuedResponse[]>;
let adminInserts: Array<{ table: string; row: unknown }>;
let dispatcherCalls: Array<Record<string, unknown>>;
let dispatcherResults: Array<{ success: boolean; error?: string }>;

function makeDb(queues: () => Record<string, QueuedResponse[]>, inserts?: () => typeof adminInserts) {
  return {
    from(table: string) {
      const response = (queues()[table] ?? []).shift() ?? { data: null, error: null, count: 0 };
      const builder: {
        [k: string]: (...args: unknown[]) => unknown;
      } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        insert: (row: unknown) => {
          inserts?.().push({ table, row });
          return builder;
        },
        upsert: (row: unknown) => {
          inserts?.().push({ table, row });
          return builder;
        },
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(response).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown,
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(() => ctxQueues),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeDb(() => adminQueues, () => adminInserts),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async (args: Record<string, unknown>) => {
    dispatcherCalls.push(args);
    return dispatcherResults.shift() ?? { success: true, messageId: 'msg-1' };
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { POST } = await import('./route');

const CONTACT = { id: 'contact-1', name: 'Rajath Kumar' };
const PROPERTY = {
  id: 'prop-1',
  title: 'Commercial BDA Property in HSR Layout',
  price: 250000000,
  listing_type: 'Sale',
  sublocality: 'HSR Layout Sector 2',
  city: 'Bangalore',
  images: [],
};
const APPROVED_TEMPLATE = {
  id: 'tpl-1',
  name: 'new_property_alert',
  status: 'APPROVED',
  language: 'en_US',
  body_text: 'Hi {{1}}! New listing: {{2}} — {{3}} at {{4}}.',
  buttons: [{ type: 'URL', text: 'View property', url: 'https://example.com/{{1}}' }],
};

function request(body: unknown) {
  return new Request('http://localhost/api/whatsapp/share-property', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

function shareBody() {
  return { contact_id: CONTACT.id, property_id: PROPERTY.id, message: 'Hi! Check this out.' };
}

/** Contact + property lookups succeed; window state is configurable. */
function primeLookups({ windowOpen, conversation = 'conv-1' }: { windowOpen: boolean; conversation?: string | null }) {
  ctxQueues = {
    contacts: [{ data: CONTACT, error: null }],
    properties: [{ data: PROPERTY, error: null }],
  };
  adminQueues = {
    conversations: [{ data: conversation ? { id: conversation } : null, error: null }],
    messages: [{ count: windowOpen ? 1 : 0 }],
  };
}

beforeEach(() => {
  ctxQueues = {};
  adminQueues = {};
  adminInserts = [];
  dispatcherCalls = [];
  dispatcherResults = [];
});

describe('share-property — channel selection', () => {
  it('sends the composed free-form message inside the 24-hour window', async () => {
    primeLookups({ windowOpen: true });
    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ sent: true, channel: 'freeform', conversation_id: 'conv-1' });
    expect(dispatcherCalls).toHaveLength(1);
    expect(dispatcherCalls[0]).toMatchObject({ kind: 'text', text: 'Hi! Check this out.' });
  });

  it('sends the approved template outside the window, with the tracking URL button param', async () => {
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [{ data: [APPROVED_TEMPLATE], error: null }];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: true, channel: 'template' });
    expect(dispatcherCalls).toHaveLength(1);
    expect(dispatcherCalls[0]).toMatchObject({
      kind: 'template',
      templateName: 'new_property_alert',
    });
    const messageParams = dispatcherCalls[0].messageParams as {
      body: string[];
      buttonParams: Record<number, string>;
    };
    expect(messageParams.body[0]).toBe('Rajath');
    expect(messageParams.buttonParams[0]).toBe(`?property_id=${PROPERTY.id}&v=${CONTACT.id}`);
  });

  it('sends on the approved Utility row while the branded name is still under review', async () => {
    // The branded template ships under a new name because Meta fixes a
    // category at review and will not re-review in place. Until it
    // clears, the working row has to keep sending.
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [
      {
        data: [
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_info', status: 'PENDING' },
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_response', category: 'Utility' },
        ],
        error: null,
      },
    ];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: true, channel: 'template' });
    expect(dispatcherCalls[0]).toMatchObject({ templateName: 'property_enquiry_response' });
  });

  it('stays on the Utility row when Meta approves the new name as Marketing', async () => {
    // Meta's real failure mode is approving a Utility submission as
    // MARKETING rather than rejecting it, and Marketing is silently
    // dropped at the recipient's per-user cap (131049).
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [
      {
        data: [
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_info', category: 'Marketing' },
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_response', category: 'Utility' },
        ],
        error: null,
      },
    ];

    await POST(request(shareBody()));

    expect(dispatcherCalls[0]).toMatchObject({ templateName: 'property_enquiry_response' });
  });

  it('moves to the branded template once Meta approves it as Utility', async () => {
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [
      {
        data: [
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_info', category: 'Utility' },
          { ...APPROVED_TEMPLATE, name: 'property_enquiry_response', category: 'Utility' },
        ],
        error: null,
      },
    ];

    await POST(request(shareBody()));

    expect(dispatcherCalls[0]).toMatchObject({ templateName: 'property_enquiry_info' });
  });

  it('falls back to the template when Meta rejects the free-form send as re-engagement', async () => {
    primeLookups({ windowOpen: true });
    adminQueues.message_templates = [{ data: [APPROVED_TEMPLATE], error: null }];
    dispatcherResults = [
      { success: false, error: '(#131047) Re-engagement message' },
      { success: true },
    ];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: true, channel: 'template' });
    expect(dispatcherCalls).toHaveLength(2);
    expect(dispatcherCalls[1]).toMatchObject({ kind: 'template' });
  });

  it('returns unsent + NONE when the window is closed and no template was ever submitted', async () => {
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [{ data: [], error: null }];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: false, template_status: 'NONE', conversation_id: 'conv-1' });
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('returns unsent + PENDING while the template awaits Meta approval', async () => {
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [
      { data: [{ ...APPROVED_TEMPLATE, status: 'PENDING' }], error: null },
    ];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: false, template_status: 'PENDING' });
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('creates the conversation for the "Open chat" fallback when none exists yet', async () => {
    primeLookups({ windowOpen: false, conversation: null });
    adminQueues.message_templates = [{ data: [], error: null }];
    // Window probe, then the resolver's own read before it inserts —
    // resolveConversation always re-reads so a lost race returns the
    // winner's thread rather than a second one.
    adminQueues.conversations = [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: 'conv-new' }, error: null },
    ];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(json.data).toMatchObject({ sent: false, conversation_id: 'conv-new' });
    expect(adminInserts).toHaveLength(1);
    expect(adminInserts[0]).toMatchObject({
      table: 'conversations',
      row: { account_id: 'acc-1', user_id: 'user-1', contact_id: 'contact-1' },
    });
  });

  it('ledgers the share so the listing can mark the recipient as already contacted', async () => {
    primeLookups({ windowOpen: true });

    await POST(request(shareBody()));

    expect(adminInserts).toContainEqual({
      table: 'property_shares',
      row: {
        account_id: 'acc-1',
        property_id: 'prop-1',
        contact_id: 'contact-1',
        recipient_kind: 'buyer',
        channel: 'whatsapp',
        created_by: 'user-1',
      },
    });
  });

  it('snapshots an agent recipient as such on the ledger', async () => {
    primeLookups({ windowOpen: true });
    adminQueues.contacts = [{ data: { classification: 'Agent' }, error: null }];

    await POST(request(shareBody()));

    expect(adminInserts).toContainEqual(
      expect.objectContaining({
        table: 'property_shares',
        row: expect.objectContaining({ recipient_kind: 'agent' }),
      }),
    );
  });

  it('does not ledger a share that was never delivered', async () => {
    primeLookups({ windowOpen: false });
    adminQueues.message_templates = [{ data: [], error: null }];

    await POST(request(shareBody()));

    expect(adminInserts.some((i) => i.table === 'property_shares')).toBe(false);
  });

  it('rejects a body without required fields', async () => {
    const res = await POST(request({ contact_id: 'contact-1' }));
    expect(res.status).toBe(400);
  });

  it('surfaces a non-window dispatcher failure as an error, not a template fallback', async () => {
    primeLookups({ windowOpen: true });
    dispatcherResults = [{ success: false, error: 'Media upload failed' }];

    const res = await POST(request(shareBody()));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBe('Media upload failed');
    expect(dispatcherCalls).toHaveLength(1);
  });
});
