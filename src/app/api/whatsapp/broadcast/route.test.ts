import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The availability note on a property broadcast: a template cannot carry
 * it, so when the agent asked for it the route sends it as free text
 * after the template to every recipient whose 24-hour window is open,
 * reports a closed window instead of attempting one, and never adds it
 * for a listing that is still Available. Meta I/O (dispatcher) and the
 * Supabase client are stubbed; the template helpers run for real.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
  count?: number;
}

let queues: Record<string, QueuedResponse[]>;
let dispatcherCalls: Array<Record<string, unknown>>;

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? {
        data: null,
        error: null,
        count: 0,
      };
      const builder: {
        [k: string]: (...args: unknown[]) => unknown;
      } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        like: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(response).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
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

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    dispatcherCalls.push(args);
    return {
      success: true,
      whatsappMessageId: `wamid-${dispatcherCalls.length}`,
    };
  },
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountPropertyShowcaseUrl: async () => 'https://acme.convoreal.com/?p=1',
  ensureTrackedPropertyShowcaseLink: (text: string) => text,
  trackedPropertyButtonParam: () => 'tracked',
}));

import { POST } from './route';

const template = {
  id: 'tpl-1',
  user_id: 'user-1',
  account_id: 'acc-1',
  name: 'property_share',
  language: 'en_US',
  status: 'APPROVED',
  body_text: 'Hi {{1}}, have a look at {{2}}.',
  header_type: 'none',
  buttons: [
    { type: 'URL', text: 'View', url: 'https://acme.convoreal.com/{{1}}' },
  ],
};

function property(status: string) {
  return {
    id: 'prop-1',
    title: '3 BHK in Koramangala',
    property_code: 'KOR-1',
    status,
  };
}

function queue(opts: { status: string; windowOpen: boolean }) {
  queues = {
    profiles: [{ data: { full_name: 'Praneeth' } }],
    whatsapp_config: [{ data: { id: 'cfg-1', catalog_id: null } }],
    properties: [{ data: property(opts.status) }],
    message_templates: [{ data: [template] }],
    contacts: [{ data: { id: 'c-1', name: 'Yusuf' } }],
    conversations: [{ data: { id: 'conv-1' } }],
    messages: [{ count: opts.windowOpen ? 2 : 0 }],
  };
}

async function broadcast(availabilityNote: boolean) {
  const request = new Request('http://localhost/api/whatsapp/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      broadcast_type: 'template',
      template_name: 'property_share',
      template_language: 'en_US',
      property_id: 'prop-1',
      availability_note: availabilityNote,
      recipients: [
        { phone: '919800000001', contact_id: 'c-1', params: ['Yusuf', 'it'] },
      ],
    }),
  });
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  dispatcherCalls = [];
});

describe('[PRP-048] availability note on a property broadcast', () => {
  it('follows the template with the note as free text inside the 24-hour window', async () => {
    queue({ status: 'Under Contract', windowOpen: true });
    const { status, body } = await broadcast(true);
    expect(status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.results[0]).toMatchObject({ status: 'sent', note: 'sent' });
    expect(dispatcherCalls.map((c) => c.kind)).toEqual(['template', 'text']);
    expect(dispatcherCalls[1]).toMatchObject({
      contactId: 'c-1',
      conversationId: 'conv-1',
      senderType: 'agent',
    });
    expect(String(dispatcherCalls[1].text)).toBe(
      'Please note: this property is currently under contract with another buyer, but the deal is not closed yet. Our team will check the latest status with the owner and update you here.'
    );
  });

  it('sends the template alone and says so when the window is closed', async () => {
    queue({ status: 'Off Market', windowOpen: false });
    const { body } = await broadcast(true);
    expect(body.results[0]).toMatchObject({
      status: 'sent',
      note: 'window_closed',
    });
    expect(dispatcherCalls.map((c) => c.kind)).toEqual(['template']);
  });

  it('adds nothing when the agent left the note out', async () => {
    queue({ status: 'Under Contract', windowOpen: true });
    const { body } = await broadcast(false);
    expect(body.results[0].note).toBeUndefined();
    expect(dispatcherCalls.map((c) => c.kind)).toEqual(['template']);
  });

  it('adds nothing for a listing that is still Available', async () => {
    queue({ status: 'Available', windowOpen: true });
    const { body } = await broadcast(true);
    expect(body.results[0].note).toBeUndefined();
    expect(dispatcherCalls.map((c) => c.kind)).toEqual(['template']);
  });
});
