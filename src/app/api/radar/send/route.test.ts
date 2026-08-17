import { beforeEach, describe, expect, it, vi } from 'vitest';

let eventRow: Record<string, unknown> | null;
const loadEligibleRadarContacts = vi.fn();

function eventDb() {
  return {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: eventRow, error: null }),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: eventDb(),
    accountId: 'account-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
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
  eventRow = {
    id: 'event-1',
    kind: 'new_property',
    property_id: 'property-1',
    contact_id: null,
    matches: [{ id: 'matched-1', name: 'Matched', score: 90, chips: [] }],
    source: 'internal',
    sent_count: 0,
  };
});

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
    eventRow = {
      ...eventRow,
      kind: 'buyer_updated',
      property_id: null,
      contact_id: 'contact-1',
    };
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
