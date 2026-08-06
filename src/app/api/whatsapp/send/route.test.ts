import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The 24-hour customer service window guard. Free-form text outside the
 * window is refused before it reaches Meta: Meta accepts such a send,
 * returns a wamid, then fails it asynchronously (131047), which used to
 * surface as a delivery-failure bubble minutes later. Templates are
 * exempt — they are how a closed window is reopened.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let dispatcherCalls: Array<Record<string, unknown>>;

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? { data: null, error: null };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
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
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { send: {} },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    dispatcherCalls.push(args);
    return { success: true, messageId: 'msg-1', whatsappMessageId: 'wamid.1' };
  },
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  parseMetaErrorInfo: () => ({
    code: 0,
    title: 'x',
    userMessage: 'x',
    suggestedActions: [],
    isRetryable: false,
  }),
}));

const { POST } = await import('./route');

const CONVERSATION = {
  data: {
    id: 'conv-1',
    account_id: 'acc-1',
    contact: { id: 'contact-1', phone: '919876543210' },
  },
  error: null,
};

function config(integrationType: string) {
  return {
    data: { id: 'cfg-1', access_token: 'enc', integration_type: integrationType },
    error: null,
  };
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

const HOURS = 60 * 60 * 1000;

beforeEach(() => {
  queues = {};
  dispatcherCalls = [];
});

describe('POST /api/whatsapp/send — customer window', () => {
  it('refuses free-form text once the window has closed', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      messages: [
        { data: { created_at: new Date(Date.now() - 30 * HOURS).toISOString() }, error: null },
      ],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'text',
      content_text: 'here are the details',
    });

    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.code).toBe('CUSTOMER_WINDOW_EXPIRED');
    expect(payload.error).toMatch(/24 hours/);
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('refuses free-form text when the contact has never messaged in', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      messages: [{ data: null, error: null }],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'text',
      content_text: 'hello',
    });

    expect(res.status).toBe(409);
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('sends free-form text while the window is open', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      messages: [
        { data: { created_at: new Date(Date.now() - 2 * HOURS).toISOString() }, error: null },
      ],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'text',
      content_text: 'still chatting',
    });

    expect(res.status).toBe(200);
    expect(dispatcherCalls).toHaveLength(1);
    expect(dispatcherCalls[0].kind).toBe('text');
  });

  it('quotes with Meta\'s wamid but persists our own row id', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      messages: [
        // The reply target, then the window lookup.
        { data: { message_id: 'wamid.parent', conversation_id: 'conv-1' }, error: null },
        { data: { created_at: new Date(Date.now() - 2 * HOURS).toISOString() }, error: null },
      ],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'text',
      content_text: 'answering that',
      reply_to_message_id: '11111111-2222-3333-4444-555555555555',
    });

    expect(res.status).toBe(200);
    // reply_to_message_id is a UUID self-FK: handing it the wamid failed
    // the insert after Meta had already delivered the message.
    expect(dispatcherCalls[0].contextMessageId).toBe('wamid.parent');
    expect(dispatcherCalls[0].replyToMessageId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('keeps the local reply link when the parent never reached Meta', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      messages: [
        { data: { message_id: null, conversation_id: 'conv-1' }, error: null },
        { data: { created_at: new Date(Date.now() - 2 * HOURS).toISOString() }, error: null },
      ],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'text',
      content_text: 'answering that',
      reply_to_message_id: '11111111-2222-3333-4444-555555555555',
    });

    expect(res.status).toBe(200);
    expect(dispatcherCalls[0].contextMessageId).toBeUndefined();
    expect(dispatcherCalls[0].replyToMessageId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('lets a template through a closed window — that is what reopens it', async () => {
    queues = {
      conversations: [CONVERSATION],
      whatsapp_config: [config('meta_cloud')],
      message_templates: [{ data: null, error: null }, { data: [], error: null }],
      messages: [{ data: null, error: null }],
    };

    const res = await post({
      conversation_id: 'conv-1',
      message_type: 'template',
      template_name: 'new_property_alert',
    });

    expect(res.status).toBe(200);
    expect(dispatcherCalls).toHaveLength(1);
    expect(dispatcherCalls[0].kind).toBe('template');
  });
});
