import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureJourneyItem = vi.fn();
const writeJourneyEvent = vi.fn();

vi.mock('./capture-server', () => ({
  ensureJourneyItem: (...args: unknown[]) => ensureJourneyItem(...args),
}));
vi.mock('./events', () => ({
  writeJourneyEvent: (...args: unknown[]) => writeJourneyEvent(...args),
}));

import {
  LEAD_INTEREST_CAPTURE_REASON,
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

function makeDb() {
  return {
    from(table: string) {
      const current: Update = { table, payload: {}, filters: [], or: [] };
      const builder = {
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
  ensureJourneyItem.mockReset();
  writeJourneyEvent.mockReset();
  ensureJourneyItem.mockResolvedValue({
    id: 'item-1',
    stage_id: 'st-1',
    status: 'active',
  });
  writeJourneyEvent.mockResolvedValue({
    ok: true,
    duplicate: false,
    eventId: 'ev-1',
    error: null,
  });
});

describe('recordJourneyLeadInterest', () => {
  it('[JRN-026] captures the pair hidden when nothing captured it, then stamps Interested and logs the tap', async () => {
    const db = makeDb();
    const result = await recordJourneyLeadInterest(db as never, {
      ...input,
      source: 'whatsapp_interested',
    });

    expect(result).toEqual({ itemId: 'item-1', error: null });
    expect(ensureJourneyItem).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c1',
        propertyId: 'p1',
        source: 'whatsapp_share',
        hidden: true,
        reason: LEAD_INTEREST_CAPTURE_REASON,
      })
    );
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

  it('[JRN-026] a typed WhatsApp enquiry and a portal enquiry count as Interested, each with its own event', async () => {
    for (const source of ['whatsapp_enquiry', 'portal_enquiry'] as const) {
      updates = [];
      writeJourneyEvent.mockClear();
      await recordJourneyLeadInterest(makeDb() as never, { ...input, source });
      expect(updates[0].payload).toMatchObject({ lead_interest: 'interested' });
      expect(writeJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: LEAD_INTEREST_EVENT_REASONS[source],
          dedupeKey: `lead_interest:${source}`,
        })
      );
    }
  });

  it('[JRN-026] a showcase check-in visit or call counts as Interested', async () => {
    const db = makeDb();
    await recordJourneyLeadInterest(db as never, {
      ...input,
      source: 'showcase_checkin',
    });
    expect(updates[0].payload).toMatchObject({ lead_interest: 'interested' });
    expect(updates[0].or).toEqual([]);
  });

  it('[JRN-026] reports, never throws, when the stages are missing or the stamp fails', async () => {
    ensureJourneyItem.mockResolvedValueOnce(null);
    expect(
      await recordJourneyLeadInterest(makeDb() as never, {
        ...input,
        source: 'whatsapp_interested',
      })
    ).toEqual({ itemId: null, error: 'Journey stages could not be loaded' });
    expect(writeJourneyEvent).not.toHaveBeenCalled();

    updateError = { message: 'boom' };
    expect(
      await recordJourneyLeadInterest(makeDb() as never, {
        ...input,
        source: 'whatsapp_interested',
      })
    ).toEqual({ itemId: 'item-1', error: 'boom' });
    expect(writeJourneyEvent).not.toHaveBeenCalled();

    updateError = null;
    ensureJourneyItem.mockRejectedValueOnce(new Error('offline'));
    expect(
      await recordJourneyLeadInterest(makeDb() as never, {
        ...input,
        source: 'whatsapp_interested',
      })
    ).toEqual({ itemId: null, error: 'offline' });
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
