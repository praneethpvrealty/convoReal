import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';

type Row = Record<string, unknown>;

let eventRow: Row;
let tables: Record<string, Row[]>;
let db: ReturnType<typeof memorySupabase>;
const loadEligibleRadarContacts = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: db,
    accountId: 'account-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => db,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/share-property-send', () => ({
  logPropertyShare: async () => undefined,
}));

vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  sendListingFeedbackPrompt: async () => undefined,
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountBrandImage: async () => null,
  accountBrandName: async () => null,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/radar/manual-contacts', () => ({
  loadEligibleRadarContacts: (...args: unknown[]) =>
    loadEligibleRadarContacts(...args),
}));

const { POST } = await import('./route');

function request(body: unknown) {
  return new Request('http://localhost/api/radar/send', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  const recentReply = new Date().toISOString();
  eventRow = {
    id: 'event-1',
    account_id: 'account-1',
    kind: 'new_property',
    property_id: 'property-1',
    contact_id: null,
    matches: [
      { id: 'matched-1', name: 'Matched', score: 90, chips: [] },
      { id: 'matched-2', name: 'Second', score: 85, chips: [] },
    ],
    source: 'internal',
    status: 'new',
    sent_count: 0,
    sent_at: null,
    send_claimed_at: null,
    sent_target_ids: null,
  };
  tables = {
    match_events: [eventRow],
    properties: [
      {
        id: 'property-1',
        account_id: 'account-1',
        title: 'Lake View Plot',
        price: 5_000_000,
        images: [],
      },
    ],
    contacts: [
      { id: 'matched-1', account_id: 'account-1', name: 'Matched' },
      { id: 'matched-2', account_id: 'account-1', name: 'Second' },
    ],
    conversations: [
      { id: 'conv-1', account_id: 'account-1', contact_id: 'matched-1' },
      { id: 'conv-2', account_id: 'account-1', contact_id: 'matched-2' },
    ],
    messages: [
      {
        conversation_id: 'conv-1',
        sender_type: 'customer',
        created_at: recentReply,
      },
      {
        conversation_id: 'conv-2',
        sender_type: 'customer',
        created_at: recentReply,
      },
    ],
    message_templates: [],
  };
  db = memorySupabase(tables);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function recipients() {
  return sendWhatsAppMessageAndPersist.mock.calls.map(
    ([args]) => (args as { contactId: string }).contactId
  );
}

describe('POST /api/radar/send manual recipients', () => {
  it('rejects a widened target unless the client identifies it as manually added', async () => {
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1', 'extra-1'] })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'One or more selected targets are not part of this alert',
    });
    expect(loadEligibleRadarContacts).not.toHaveBeenCalled();
  });

  it('rejects manually added recipients for buyer-update events', async () => {
    Object.assign(eventRow, {
      kind: 'buyer_updated',
      property_id: null,
      contact_id: 'contact-1',
    });
    const response = await POST(
      request({
        eventId: 'event-1',
        targetIds: ['extra-1'],
        manualContactIds: ['extra-1'],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Contacts can only be added to new listing alerts',
    });
  });

  it('revalidates lifecycle and consent eligibility at send time', async () => {
    loadEligibleRadarContacts.mockResolvedValue([]);
    const response = await POST(
      request({
        eventId: 'event-1',
        targetIds: ['extra-1'],
        manualContactIds: ['extra-1'],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'One or more added contacts are no longer eligible for alerts',
    });
    expect(loadEligibleRadarContacts).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      { ids: ['extra-1'], limit: 1 }
    );
  });
});

describe('POST /api/radar/send claim', () => {
  it('[RDR-001] claims the event, sends, then marks it sent and releases the claim', async () => {
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(recipients()).toEqual(['matched-1']);
    expect(eventRow).toMatchObject({
      status: 'sent',
      sent_count: 1,
      send_claimed_at: null,
      sent_target_ids: ['matched-1'],
    });
  });

  it('[RDR-001] refuses a second send while the first is still going out and sends nothing', async () => {
    const meta = deferred<{ success: boolean }>();
    sendWhatsAppMessageAndPersist.mockReturnValueOnce(meta.promise);

    const first = POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );
    await vi.waitFor(() =>
      expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1)
    );
    expect(eventRow.send_claimed_at).toEqual(expect.any(String));

    const second = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1', 'matched-2'] })
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: 'This alert is already being sent.',
      code: 'SEND_IN_PROGRESS',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);

    meta.resolve({ success: true });
    expect((await first).status).toBe(200);
    expect(recipients()).toEqual(['matched-1']);
    expect(eventRow.status).toBe('sent');
  });

  it('[RDR-001] refuses to send an event that already went out', async () => {
    await POST(request({ eventId: 'event-1', targetIds: ['matched-1'] }));
    const again = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'ALREADY_SENT' });
    expect(recipients()).toEqual(['matched-1']);
    expect(eventRow.sent_count).toBe(1);
  });

  it('[RDR-001] sends a later batch only to recipients who do not have the alert yet', async () => {
    await POST(request({ eventId: 'event-1', targetIds: ['matched-1'] }));
    const later = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1', 'matched-2'] })
    );

    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({ sent: 1 });
    expect(recipients()).toEqual(['matched-1', 'matched-2']);
    expect(eventRow).toMatchObject({
      status: 'sent',
      sent_count: 2,
      sent_target_ids: ['matched-1', 'matched-2'],
    });
  });

  it('[RDR-001] refuses an event sent before recipients were recorded', async () => {
    Object.assign(eventRow, { status: 'sent', sent_count: 1 });
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ALREADY_SENT' });
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(eventRow.send_claimed_at).toBeNull();
  });

  it('[RDR-001] releases the claim when nothing was delivered so the card can be retried', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValueOnce({
      success: false,
      error: 'Meta rejected the message',
    });
    const failed = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(eventRow).toMatchObject({ status: 'new', send_claimed_at: null });

    const retry = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );
    expect(retry.status).toBe(200);
    expect(recipients()).toEqual(['matched-1', 'matched-1']);
    expect(eventRow.status).toBe('sent');
  });

  it('[RDR-001] releases the claim when the send throws before anything was delivered', async () => {
    sendWhatsAppMessageAndPersist.mockRejectedValueOnce(new Error('boom'));
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(response.status).toBe(500);
    expect(eventRow).toMatchObject({ status: 'new', send_claimed_at: null });
  });

  it('[RDR-001] keeps what was delivered when a later target throws', async () => {
    sendWhatsAppMessageAndPersist
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('boom'));
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1', 'matched-2'] })
    );

    expect(response.status).toBe(500);
    expect(eventRow).toMatchObject({
      status: 'sent',
      send_claimed_at: null,
      sent_target_ids: ['matched-1'],
    });
  });

  it('[RDR-001] skips recipients who already have the alert when a stale claim is retried', async () => {
    Object.assign(eventRow, {
      send_claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      sent_target_ids: ['matched-1'],
    });
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1', 'matched-2'] })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1 });
    expect(recipients()).toEqual(['matched-2']);
    expect(eventRow).toMatchObject({
      status: 'sent',
      sent_count: 1,
      send_claimed_at: null,
      sent_target_ids: ['matched-1', 'matched-2'],
    });
  });

  it('[RDR-001] answers already sent when a stale claim had reached every selected recipient', async () => {
    Object.assign(eventRow, {
      send_claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      sent_target_ids: ['matched-1'],
    });
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ALREADY_SENT' });
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(eventRow).toMatchObject({ status: 'sent', send_claimed_at: null });
  });

  it('[RDR-001] refuses while another send holds a live claim', async () => {
    eventRow.send_claimed_at = new Date(Date.now() - 60_000).toISOString();
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'] })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SEND_IN_PROGRESS' });
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('[RDR-001] lets Send again resend an event that already went out', async () => {
    Object.assign(eventRow, {
      status: 'sent',
      sent_count: 1,
      sent_target_ids: ['matched-1'],
    });
    const response = await POST(
      request({ eventId: 'event-1', targetIds: ['matched-1'], resend: true })
    );

    expect(response.status).toBe(200);
    expect(recipients()).toEqual(['matched-1']);
    expect(eventRow).toMatchObject({
      status: 'sent',
      sent_count: 2,
      send_claimed_at: null,
    });
  });
});
