import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeJourneyEvent = vi.fn();

vi.mock('./events', () => ({
  writeJourneyEvent: (...args: unknown[]) => writeJourneyEvent(...args),
}));

import {
  LEAD_INTEREST_EVENT_REASONS,
  clearJourneyLeadInterest,
  recordJourneyLeadInterest,
} from './lead-interest';

interface Update {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
  or: string[];
}

let updates: Update[];
let updateError: { message: string } | null;
let reads: Record<string, unknown[]>;
let readError: { message: string } | null;

function makeDb() {
  return {
    from(table: string) {
      const current: Update = { table, payload: {}, filters: [], or: [] };
      const builder = {
        select() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: readError ? null : ((reads[table] ?? []).shift() ?? null),
            error: readError,
          });
        },
        update(payload: Record<string, unknown>) {
          current.payload = payload;
          updates.push(current);
          return builder;
        },
        eq(column: string, value: unknown) {
          current.filters.push([column, value]);
          return builder;
        },
        or(expr: string) {
          current.or.push(expr);
          return builder;
        },
        in(column: string, value: unknown) {
          current.filters.push([column, value]);
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          current.filters.push([`${column}.not.${op}`, value]);
          return builder;
        },
        then(
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown
        ) {
          return Promise.resolve({ error: updateError }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const input = {
  accountId: 'acc-1',
  userId: 'owner-1',
  contactId: 'c1',
  propertyId: 'p1',
};

beforeEach(() => {
  updates = [];
  updateError = null;
  reads = { journey_items: [{ id: 'item-1' }] };
  readError = null;
  writeJourneyEvent.mockReset();
  writeJourneyEvent.mockResolvedValue({
    ok: true,
    duplicate: false,
    eventId: 'ev-1',
    error: null,
  });
});

describe('recordJourneyLeadInterest', () => {
  it("[JRN-026] stamps the pair's journey item Interested and logs the tap once per source", async () => {
    const db = makeDb();
    const result = await recordJourneyLeadInterest(db as never, {
      ...input,
      source: 'whatsapp_interested',
    });

    expect(result).toEqual({ itemId: 'item-1', error: null });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('journey_items');
    expect(updates[0].payload).toMatchObject({ lead_interest: 'interested' });
    expect(typeof updates[0].payload.lead_interest_at).toBe('string');
    expect(updates[0].filters).toEqual([
      ['id', 'item-1'],
      ['account_id', 'acc-1'],
    ]);
    expect(updates[0].or).toEqual([]);
    expect(writeJourneyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        itemId: 'item-1',
        eventType: 'client_response',
        createdBy: 'owner-1',
        reason: LEAD_INTEREST_EVENT_REASONS.whatsapp_interested,
        dedupeKey: 'lead_interest:whatsapp_interested',
      })
    );
  });

  it('[JRN-009] [JRN-026] never creates a pair: a yes on a listing not on the journey, or removed from the tray, stamps nothing', async () => {
    reads = { journey_items: [null] };
    const result = await recordJourneyLeadInterest(makeDb() as never, {
      ...input,
      source: 'portal_enquiry',
    });
    expect(result).toEqual({ itemId: null, error: null });
    expect(updates).toEqual([]);
    expect(writeJourneyEvent).not.toHaveBeenCalled();
  });

  it('[JRN-026] a Shortlist tap never downgrades a branch the lead already said Interested on', async () => {
    const db = makeDb();
    await recordJourneyLeadInterest(db as never, {
      ...input,
      source: 'whatsapp_shortlist',
    });

    expect(updates[0].payload).toMatchObject({ lead_interest: 'shortlisted' });
    expect(updates[0].or).toEqual([
      'lead_interest.is.null,lead_interest.neq.interested',
    ]);
    expect(writeJourneyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: LEAD_INTEREST_EVENT_REASONS.whatsapp_shortlist,
        dedupeKey: 'lead_interest:whatsapp_shortlist',
      })
    );
  });

  it('[JRN-026] a typed WhatsApp enquiry, a portal enquiry and a showcase check-in count as Interested, each with its own event', async () => {
    for (const source of [
      'whatsapp_enquiry',
      'portal_enquiry',
      'showcase_checkin',
    ] as const) {
      updates = [];
      reads = { journey_items: [{ id: 'item-1' }] };
      writeJourneyEvent.mockClear();
      await recordJourneyLeadInterest(makeDb() as never, { ...input, source });
      expect(updates[0].payload).toMatchObject({ lead_interest: 'interested' });
      expect(updates[0].or).toEqual([]);
      expect(writeJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: LEAD_INTEREST_EVENT_REASONS[source],
          dedupeKey: `lead_interest:${source}`,
        })
      );
    }
  });

  it('[JRN-026] reports, never throws, when the read or the stamp fails', async () => {
    readError = { message: 'offline' };
    expect(
      await recordJourneyLeadInterest(makeDb() as never, {
        ...input,
        source: 'whatsapp_interested',
      })
    ).toEqual({ itemId: null, error: 'offline' });
    expect(writeJourneyEvent).not.toHaveBeenCalled();

    readError = null;
    updateError = { message: 'boom' };
    expect(
      await recordJourneyLeadInterest(makeDb() as never, {
        ...input,
        source: 'whatsapp_interested',
      })
    ).toEqual({ itemId: 'item-1', error: 'boom' });
    expect(writeJourneyEvent).not.toHaveBeenCalled();
  });
});

describe('clearJourneyLeadInterest', () => {
  it('[JRN-026] takes back the yes on exactly the listings the lead said no to', async () => {
    const db = makeDb();
    await clearJourneyLeadInterest(db as never, {
      accountId: 'acc-1',
      contactId: 'c1',
      propertyIds: ['p1', 'p2'],
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('journey_items');
    expect(updates[0].payload).toEqual({
      lead_interest: null,
      lead_interest_at: null,
    });
    expect(updates[0].filters).toEqual([
      ['account_id', 'acc-1'],
      ['contact_id', 'c1'],
      ['property_id', ['p1', 'p2']],
      ['lead_interest.not.is', null],
    ]);
  });

  it('[JRN-026] writes nothing for an empty list', async () => {
    await clearJourneyLeadInterest(makeDb() as never, {
      accountId: 'acc-1',
      contactId: 'c1',
      propertyIds: [],
    });
    expect(updates).toEqual([]);
  });
});
