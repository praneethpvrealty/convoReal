import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

const { recordPropertyShares } = await import('./share-log');

const calls: Array<{ url: string; init: RequestInit }> = [];
let response: { ok: boolean; status: number; body: unknown };

beforeEach(() => {
  calls.length = 0;
  response = { ok: true, status: 200, body: { data: { recorded: 2 } } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: response.ok,
        status: response.status,
        json: async () =>
          typeof response.body === 'function'
            ? response.body(calls.length)
            : response.body,
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

    expect(result).toEqual({ created: 2, error: null });
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

  it('[JRN-021] retries the recipients the server could not record and reports a share still missing', async () => {
    response = {
      ok: true,
      status: 200,
      body: (call: number) => ({
        data: { recorded: call === 1 ? 1 : 0, failed: ['contact-2'] },
      }),
    };
    const result = await recordPropertyShares({
      accountId: 'account-1',
      propertyId: 'property-1',
      recipients: [{ contactId: 'contact-1' }, { contactId: 'contact-2' }],
    });

    expect(calls).toHaveLength(3);
    expect(
      calls.map((call) =>
        JSON.parse(call.init.body as string).recipients.map(
          (r: { contact_id: string }) => r.contact_id
        )
      )
    ).toEqual([['contact-1', 'contact-2'], ['contact-2'], ['contact-2']]);
    expect(result).toEqual({
      created: 1,
      error: '1 of 2 shares could not be recorded',
    });
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
