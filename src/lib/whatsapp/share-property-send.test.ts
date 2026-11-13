import { beforeEach, describe, expect, it, vi } from 'vitest';

const captures: Array<Record<string, unknown>> = [];
let captureImpl: (input: Record<string, unknown>) => Promise<unknown>;
vi.mock('@/lib/journey/capture-server', () => ({
  captureJourneyItems: vi.fn(
    async (_db: unknown, input: Record<string, unknown>) => captureImpl(input)
  ),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

const { logListingsSent, logPropertyShare } =
  await import('./share-property-send');

let upserts: Array<{ table: string; row: unknown }>;
let stamps: Array<{ table: string; row: unknown; filters: unknown[][] }>;

function makeDb(
  classification: string | null = 'Buyer',
  upsertError: { message: string } | null = null
) {
  return {
    from(table: string) {
      const filters: unknown[][] = [];
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          filters.push(['eq', ...args]);
          return builder;
        },
        in: (...args: unknown[]) => {
          filters.push(['in', ...args]);
          return builder;
        },
        update: (row: unknown) => {
          stamps.push({ table, row, filters });
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({ data: { classification }, error: null }),
        upsert: (row: unknown) => {
          upserts.push({ table, row });
          return builder;
        },
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve({ data: null, error: upsertError }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  } as never;
}

beforeEach(() => {
  captures.length = 0;
  upserts = [];
  stamps = [];
  captureImpl = async (input) => {
    captures.push(input);
    return { created: 1, error: null };
  };
});

describe('[JRN-009] logPropertyShare', () => {
  it('writes the ledger row and captures the pair hidden by default', async () => {
    const recorded = await logPropertyShare(
      makeDb(),
      'acc-1',
      'user-1',
      'p-1',
      'c-1'
    );

    expect(recorded).toBe(true);
    expect(upserts).toEqual([
      {
        table: 'property_shares',
        row: {
          account_id: 'acc-1',
          property_id: 'p-1',
          contact_id: 'c-1',
          recipient_kind: 'buyer',
          channel: 'whatsapp',
          created_by: 'user-1',
          journey_visible: false,
        },
      },
    ]);
    expect(captures).toEqual([
      {
        accountId: 'acc-1',
        userId: 'user-1',
        pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
        source: 'whatsapp_share',
        hidden: true,
      },
    ]);
  });

  it('shows a deliberate share on the journey and keeps the channel it was sent on', async () => {
    await logPropertyShare(makeDb(), 'acc-1', 'user-1', 'p-1', 'c-1', 'Agent', {
      channel: 'email',
      journeyVisible: true,
    });

    expect(upserts[0].row).toMatchObject({
      recipient_kind: 'agent',
      channel: 'email',
      journey_visible: true,
    });
    expect(captures[0]).toMatchObject({ hidden: false });
  });

  it('never lets a journey failure fail the share, and reports it unrecorded', async () => {
    captureImpl = async () => {
      throw new Error('journey down');
    };
    await expect(
      logPropertyShare(makeDb(), 'acc-1', 'user-1', 'p-1', 'c-1')
    ).resolves.toBe(false);
    expect(upserts).toHaveLength(1);
  });

  it('[JRN-021] reports a journey capture that came back with an error', async () => {
    captureImpl = async () => ({ created: 0, error: 'rls' });
    await expect(
      logPropertyShare(makeDb(), 'acc-1', 'user-1', 'p-1', 'c-1')
    ).resolves.toBe(false);
  });

  it('[JRN-021] reports a ledger write that failed and still attempts the journey capture', async () => {
    await expect(
      logPropertyShare(
        makeDb('Buyer', { message: 'ledger down' }),
        'acc-1',
        'user-1',
        'p-1',
        'c-1'
      )
    ).resolves.toBe(false);
    expect(captures).toHaveLength(1);
  });
});

describe('[JRN-009] logListingsSent', () => {
  it('captures every listing the bot sent, hidden, once each', async () => {
    await logListingsSent(makeDb(), 'acc-1', null, 'c-1', [
      'p-1',
      'p-2',
      'p-1',
    ]);

    expect(upserts[0].row).toEqual([
      expect.objectContaining({
        property_id: 'p-1',
        created_by: null,
        journey_visible: false,
      }),
      expect.objectContaining({
        property_id: 'p-2',
        created_by: null,
        journey_visible: false,
      }),
    ]);
    expect(captures).toEqual([
      {
        accountId: 'acc-1',
        userId: null,
        pairs: [
          { contactId: 'c-1', propertyId: 'p-1' },
          { contactId: 'c-1', propertyId: 'p-2' },
        ],
        source: 'whatsapp_share',
        hidden: true,
      },
    ]);
  });

  it('does nothing for an empty batch', async () => {
    await logListingsSent(makeDb(), 'acc-1', null, 'c-1', []);
    expect(upserts).toEqual([]);
    expect(captures).toEqual([]);
  });
});

describe('[PRP-061] last-shared stamp', () => {
  it('stamps when the pair was last sent on every share, first or repeat', async () => {
    await logPropertyShare(makeDb(), 'acc-1', 'user-1', 'prop-1', 'contact-1');
    expect(stamps).toHaveLength(1);
    expect(stamps[0].table).toBe('property_shares');
    expect(stamps[0].row).toEqual({ last_shared_at: expect.any(String) });
    expect(stamps[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', 'acc-1'],
        ['eq', 'contact_id', 'contact-1'],
        ['in', 'property_id', ['prop-1']],
      ])
    );
  });

  it('stamps every listing a bot batch sent', async () => {
    await logListingsSent(makeDb(), 'acc-1', null, 'contact-1', [
      'prop-1',
      'prop-2',
      'prop-1',
    ]);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].filters).toEqual(
      expect.arrayContaining([['in', 'property_id', ['prop-1', 'prop-2']]])
    );
  });

  it('does not stamp when the ledger write failed', async () => {
    await logPropertyShare(
      makeDb('Buyer', { message: 'denied' }),
      'acc-1',
      'user-1',
      'prop-1',
      'contact-1'
    );
    expect(stamps).toHaveLength(0);
  });
});
