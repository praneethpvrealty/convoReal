import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * POST /api/journey/events
 *
 * Logs outbound personal WhatsApp hand-offs from journey actions into
 * timeline events. The handler is intentionally strict on item ownership
 * and request shape to avoid cross-account writes.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
const writeJourneyEventMock = vi.fn();
const ACCOUNT_ID = 'acc-1';
const USER_ID = 'user-1';

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? { data: null, error: null };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
        insert: () => builder,
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: ACCOUNT_ID,
    userId: USER_ID,
  }),
  toErrorResponse: () =>
    Response.json({ error: 'forbidden' }, { status: 403 }),
}));

vi.mock('@/lib/journey/events', () => ({
  writeJourneyEvent: (...args: unknown[]) => writeJourneyEventMock(...args),
}));

const { POST } = await import('./route');

function post(body: { item_id: string; message: string; source: 'web' | 'mobile' }) {
  return POST(
    new Request('http://localhost/api/journey/events', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  queues = {};
  writeJourneyEventMock.mockReset();
});

describe('POST /api/journey/events', () => {
  it('logs outbound personal WhatsApp messages for a valid journey item', async () => {
    writeJourneyEventMock.mockResolvedValueOnce({
      ok: true,
      duplicate: false,
      eventId: 'je-1',
      error: null,
    });
    queues = {
      journey_items: [
        {
          data: {
            id: 'ji-1',
            contact_id: 'c-1',
            property_id: 'p-1',
          },
          error: null,
        },
      ],
    };

    const res = await post({
      item_id: 'ji-1',
      message: 'Hi there',
      source: 'mobile',
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true, duplicate: false, eventId: 'je-1' });
    expect(writeJourneyEventMock).toHaveBeenCalledTimes(1);
    expect(writeJourneyEventMock.mock.calls[0]?.[0]).toMatchObject({
      db: expect.any(Object),
      accountId: ACCOUNT_ID,
      itemId: 'ji-1',
      eventType: 'outbound_whatsapp',
      createdBy: USER_ID,
      dedupeKey: createHash('sha256')
        .update('ji-1|mobile|user-1|Hi there')
        .digest('hex'),
      metadata: {
        channel: 'personal_whatsapp',
        source: 'mobile',
        sender_type: 'agent',
        sender_id: USER_ID,
        item_id: 'ji-1',
        contact_id: 'c-1',
        property_id: 'p-1',
        message: 'Hi there',
        message_length: 8,
      },
    });
  });

  it('returns duplicate when the event was already persisted', async () => {
    writeJourneyEventMock.mockResolvedValueOnce({
      ok: true,
      duplicate: true,
      eventId: null,
      error: null,
    });
    queues = {
      journey_items: [
        {
          data: {
            id: 'ji-1',
            contact_id: 'c-1',
            property_id: 'p-1',
          },
          error: null,
        },
      ],
    };

    const res = await post({
      item_id: 'ji-1',
      message: 'Hi there',
      source: 'mobile',
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true, duplicate: true, eventId: null });
  });

  it('rejects missing payload fields', async () => {
    const res = await post({
      item_id: '',
      message: '',
      source: 'web',
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });

  it('returns 404 when the journey item is not in the account', async () => {
    queues = {
      journey_items: [{ data: null, error: null }],
    };

    const res = await post({
      item_id: 'missing',
      message: 'Hi there',
      source: 'web',
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Journey item not found');
  });

  it('returns 500 when journey event persistence fails', async () => {
    writeJourneyEventMock.mockResolvedValueOnce({
      ok: false,
      duplicate: false,
      eventId: null,
      error: 'boom',
    });
    queues = {
      journey_items: [
        {
          data: {
            id: 'ji-1',
            contact_id: 'c-1',
            property_id: 'p-1',
          },
          error: null,
        },
      ],
    };

    const res = await post({
      item_id: 'ji-1',
      message: 'Hi there',
      source: 'mobile',
    });

    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.error).toBe('boom');
  });
});
