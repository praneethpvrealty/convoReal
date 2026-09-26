import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

const { recordPropertyShares } = await import('./share-log');

const calls: Array<{ url: string; init: RequestInit }> = [];
let response: { ok: boolean; status: number; body: unknown };

beforeEach(() => {
  calls.length = 0;
  response = { ok: true, status: 200, body: { data: { recorded: 1 } } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
      };
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[JRN-009] recordPropertyShares goes through the server ledger', () => {
  it('records a broadcast share hidden, in one request that captures the journey too', async () => {
    const result = await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      userId: 'user-1',
      recipients: [
        { contactId: 'contact-1', classification: 'Buyer' },
        { contactId: 'contact-2', classification: 'Agent' },
      ],
    });

    expect(result).toEqual({ created: 1, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/properties/share-log');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      property_id: 'property-1',
      recipients: [
        { contact_id: 'contact-1', classification: 'Buyer' },
        { contact_id: 'contact-2', classification: 'Agent' },
      ],
      channel: 'whatsapp',
      journey_visible: false,
    });
  });

  it('shows a deliberate one-to-one share on the journey map and keeps the email channel', async () => {
    await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      userId: 'user-1',
      recipients: [{ contactId: 'contact-1' }],
      channel: 'email',
      journeyVisible: true,
    });

    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      channel: 'email',
      journey_visible: true,
      recipients: [{ contact_id: 'contact-1', classification: null }],
    });
  });

  it('reports the server refusal instead of pretending nothing was new', async () => {
    response = { ok: false, status: 403, body: { error: 'Forbidden' } };
    const result = await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      recipients: [{ contactId: 'contact-1' }],
    });
    expect(result).toEqual({ created: 0, error: 'Forbidden' });
  });

  it('sends nothing for an empty recipient list', async () => {
    const result = await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      recipients: [],
    });
    expect(result).toEqual({ created: 0, error: null });
    expect(calls).toHaveLength(0);
  });
});
