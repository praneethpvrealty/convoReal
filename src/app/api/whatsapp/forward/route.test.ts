import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Forwarding a message's text to other contacts. The recipient list is
 * account-scoped and capped, and each send reports its own outcome — a
 * contact outside the 24-hour window is a different answer from a
 * failed send, and the app says so rather than showing one verdict.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let dispatcherCalls: Array<Record<string, unknown>>;
let dispatcherResults: Array<{ success: boolean; error?: string }>;

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? {
        data: null,
        error: null,
      };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        in: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
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
  toErrorResponse: () => Response.json({ error: 'forbidden' }, { status: 403 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { send: {} },
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    dispatcherCalls.push(args);
    return dispatcherResults.shift() ?? { success: true };
  },
}));

const { POST } = await import('./route');

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/whatsapp/forward', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

const MESSAGE = {
  data: { id: 'msg-1', content_text: 'Plot in Koramangala, 4200 sqft' },
  error: null,
};

beforeEach(() => {
  queues = {};
  dispatcherCalls = [];
  dispatcherResults = [];
});

describe('POST /api/whatsapp/forward', () => {
  it('sends the text to every picked contact', async () => {
    queues = {
      messages: [MESSAGE],
      contacts: [
        {
          data: [
            { id: 'c-1', name: 'Asha', phone: '919876543210' },
            { id: 'c-2', name: null, phone: '919876543211' },
          ],
          error: null,
        },
      ],
    };

    const res = await post({
      message_id: 'msg-1',
      contact_ids: ['c-1', 'c-2'],
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.results).toEqual([
      { contact_id: 'c-1', name: 'Asha', sent: true },
      { contact_id: 'c-2', name: '919876543211', sent: true },
    ]);
    expect(dispatcherCalls).toHaveLength(2);
    expect(dispatcherCalls[0].text).toBe('Plot in Koramangala, 4200 sqft');
    expect(dispatcherCalls[0].kind).toBe('text');
    expect(dispatcherCalls[0].senderType).toBe('agent');
    // No conversation is named: the dispatcher resolves or creates the
    // recipient's own thread.
    expect(dispatcherCalls[0].conversationId).toBeUndefined();
  });

  it('reports a closed window apart from a real failure', async () => {
    queues = {
      messages: [MESSAGE],
      contacts: [
        {
          data: [
            { id: 'c-1', name: 'Asha', phone: '919876543210' },
            { id: 'c-2', name: 'Bala', phone: '919876543211' },
          ],
          error: null,
        },
      ],
    };
    dispatcherResults = [
      {
        success: false,
        error: 'Cannot send free-form text: more than 24 hours',
      },
      { success: false, error: 'Invalid phone number' },
    ];

    const { data } = await (
      await post({ message_id: 'msg-1', contact_ids: ['c-1', 'c-2'] })
    ).json();

    expect(data.results[0]).toMatchObject({ sent: false, window_closed: true });
    expect(data.results[1]).toMatchObject({
      sent: false,
      window_closed: false,
    });
  });

  it('forwards what was composed, not the delivery-failure note on it', async () => {
    queues = {
      messages: [
        {
          data: {
            id: 'msg-1',
            content_text:
              'Plot in Koramangala\n\n❌ Delivery Failed:\n[Error 131049] not delivered',
          },
          error: null,
        },
      ],
      contacts: [
        {
          data: [{ id: 'c-1', name: 'Asha', phone: '919876543210' }],
          error: null,
        },
      ],
    };

    await post({ message_id: 'msg-1', contact_ids: ['c-1'] });

    expect(dispatcherCalls[0].text).toBe('Plot in Koramangala');
  });

  it('refuses a message with nothing to forward', async () => {
    queues = {
      messages: [{ data: { id: 'msg-1', content_text: null }, error: null }],
    };

    const res = await post({ message_id: 'msg-1', contact_ids: ['c-1'] });

    expect(res.status).toBe(400);
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('404s a message the caller cannot see', async () => {
    queues = { messages: [{ data: null, error: null }] };

    const res = await post({
      message_id: 'someone-elses',
      contact_ids: ['c-1'],
    });

    expect(res.status).toBe(404);
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('caps the fan-out, pointing bulk sends at broadcasts', async () => {
    const res = await post({
      message_id: 'msg-1',
      contact_ids: Array.from({ length: 11 }, (_, i) => `c-${i}`),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/broadcast/i);
    expect(dispatcherCalls).toHaveLength(0);
  });

  it('sends once to a contact picked twice', async () => {
    queues = {
      messages: [MESSAGE],
      contacts: [
        {
          data: [{ id: 'c-1', name: 'Asha', phone: '919876543210' }],
          error: null,
        },
      ],
    };

    await post({ message_id: 'msg-1', contact_ids: ['c-1', 'c-1'] });

    expect(dispatcherCalls).toHaveLength(1);
  });
});
