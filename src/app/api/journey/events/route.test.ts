import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: () =>
    Response.json({ error: 'forbidden' }, { status: 403 }),
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
});

describe('POST /api/journey/events', () => {
  it('logs outbound personal WhatsApp messages for a valid journey item', async () => {
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
      journey_events: [
        {
          data: { id: 'je-1' },
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
  });

  it('returns duplicate when the event was already persisted', async () => {
    queues = {
      journey_items: [
        {
          data: { id: 'ji-1', contact_id: 'c-1', property_id: 'p-1' },
          error: null,
        },
      ],
      journey_events: [
        {
          data: null,
          error: { code: '23505' } as Record<string, unknown>,
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
});

