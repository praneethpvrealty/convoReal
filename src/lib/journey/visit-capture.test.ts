import { beforeEach, describe, expect, it, vi } from 'vitest';

const moveJourneyItem = vi.fn();
vi.mock('@/lib/journey/move', () => ({
  moveJourneyItem: (...args: unknown[]) => moveJourneyItem(...args),
}));

const ensureJourneyItem = vi.fn();
const loadJourneyStages = vi.fn();
vi.mock('@/lib/journey/capture-server', () => ({
  ensureJourneyItem: (...args: unknown[]) => ensureJourneyItem(...args),
  loadJourneyStages: (...args: unknown[]) => loadJourneyStages(...args),
}));

const {
  advanceJourneyToSiteVisit,
  pickSiteVisitStage,
  recordSiteVisitBooked,
  recordVisitRequestOnJourney,
  shouldAdvanceToSiteVisit,
  SITE_VISIT_BOOKED_REASON,
  VISIT_REQUEST_CAPTURE_REASON,
} = await import('./visit-capture');

const STAGES = [
  { id: 'stage-new', name: 'New Inquiry', position: 0 },
  { id: 'stage-qualified', name: 'Profiling/Qualified', position: 1 },
  { id: 'stage-visit', name: 'Site Visit Scheduled', position: 2 },
  { id: 'stage-nego', name: 'Negotiation/Token', position: 3 },
];

let writes: Array<{ table: string; op: string; row: unknown }>;

function makeDb() {
  return {
    from(table: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        insert: (row: unknown) => {
          writes.push({ table, op: 'insert', row });
          return builder;
        },
        update: (row: unknown) => {
          writes.push({ table, op: 'update', row });
          return builder;
        },
        eq: () => builder,
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve({ data: null, error: null }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  } as never;
}

beforeEach(() => {
  writes = [];
  moveJourneyItem.mockReset();
  ensureJourneyItem.mockReset();
  loadJourneyStages.mockReset();
  loadJourneyStages.mockResolvedValue(STAGES);
  moveJourneyItem.mockResolvedValue({
    ok: true,
    itemId: 'item-1',
    stageId: 'stage-visit',
    stageName: 'Site Visit Scheduled',
    dealId: null,
  });
});

describe('[JRN-010] the site-visit stage', () => {
  it('is the first mirrored stage whose name says site visit', () => {
    expect(pickSiteVisitStage(STAGES)?.id).toBe('stage-visit');
    expect(
      pickSiteVisitStage([
        { id: 'b', name: 'Site visit done', position: 5 },
        { id: 'a', name: 'SITE-VISIT booked', position: 2 },
      ])?.id
    ).toBe('a');
    expect(
      pickSiteVisitStage([{ id: 'x', name: 'Viewing', position: 2 }])
    ).toBeNull();
  });

  it('is reached only by moving forward', () => {
    expect(shouldAdvanceToSiteVisit(STAGES[0], STAGES[2])).toBe(true);
    expect(shouldAdvanceToSiteVisit(STAGES[2], STAGES[2])).toBe(false);
    expect(shouldAdvanceToSiteVisit(STAGES[3], STAGES[2])).toBe(false);
    expect(shouldAdvanceToSiteVisit(null, STAGES[2])).toBe(true);
  });
});

describe('[JRN-010] recordVisitRequestOnJourney', () => {
  it('captures the pair visibly and logs the words as a client response', async () => {
    ensureJourneyItem.mockResolvedValue({
      id: 'item-1',
      stage_id: 'stage-new',
      status: 'active',
    });

    const item = await recordVisitRequestOnJourney({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      contactId: 'c-1',
      propertyId: 'p-1',
      text: '  I want to visit the property on Sunday sometime ..  ',
    });

    expect(item?.id).toBe('item-1');
    expect(ensureJourneyItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'user-1',
        contactId: 'c-1',
        propertyId: 'p-1',
        source: 'chat_import',
        hidden: false,
        reason: VISIT_REQUEST_CAPTURE_REASON,
      })
    );
    expect(writes[0]).toEqual({
      table: 'journey_events',
      op: 'insert',
      row: {
        account_id: 'acc-1',
        item_id: 'item-1',
        event_type: 'client_response',
        reason: 'I want to visit the property on Sunday sometime ..',
      },
    });
    expect(writes[1]).toMatchObject({ table: 'journey_items', op: 'update' });
  });

  it('logs no event for empty words', async () => {
    ensureJourneyItem.mockResolvedValue({
      id: 'item-1',
      stage_id: 'stage-new',
      status: 'active',
    });
    await recordVisitRequestOnJourney({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      contactId: 'c-1',
      propertyId: 'p-1',
      text: '   ',
    });
    expect(writes).toEqual([]);
  });
});

describe('[JRN-010] advanceJourneyToSiteVisit', () => {
  it('advances a branch below the site-visit stage through the board move', async () => {
    const outcome = await advanceJourneyToSiteVisit({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      item: { id: 'item-1', stage_id: 'stage-new', status: 'active' },
    });

    expect(outcome).toBe('advanced');
    expect(moveJourneyItem).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', userId: 'user-1' }),
      {
        itemId: 'item-1',
        stageId: 'stage-visit',
        eventType: 'advanced',
        brokerage: null,
        requireBrokerage: false,
        reason: SITE_VISIT_BOOKED_REASON,
        source: 'system',
      }
    );
  });

  it('never pulls a branch back from a later stage', async () => {
    const outcome = await advanceJourneyToSiteVisit({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      item: { id: 'item-1', stage_id: 'stage-nego', status: 'active' },
    });
    expect(outcome).toBe('already_past');
    expect(moveJourneyItem).not.toHaveBeenCalled();
  });

  it('does nothing when the account has no site-visit stage', async () => {
    loadJourneyStages.mockResolvedValue([STAGES[0], STAGES[3]]);
    const outcome = await advanceJourneyToSiteVisit({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      item: { id: 'item-1', stage_id: 'stage-new', status: 'active' },
    });
    expect(outcome).toBe('no_stage');
    expect(moveJourneyItem).not.toHaveBeenCalled();
  });
});

describe('[JRN-010] recordSiteVisitBooked', () => {
  it('records the words, then advances, and swallows a journey failure', async () => {
    ensureJourneyItem.mockResolvedValue({
      id: 'item-1',
      stage_id: 'stage-qualified',
      status: 'active',
    });
    const outcome = await recordSiteVisitBooked({
      db: makeDb(),
      accountId: 'acc-1',
      userId: 'user-1',
      contactId: 'c-1',
      propertyId: 'p-1',
      text: 'Visit Sunday 11am',
    });
    expect(outcome).toBe('advanced');
    expect(writes[0]).toMatchObject({
      table: 'journey_events',
      row: { event_type: 'client_response', reason: 'Visit Sunday 11am' },
    });

    ensureJourneyItem.mockRejectedValue(new Error('down'));
    await expect(
      recordSiteVisitBooked({
        db: makeDb(),
        accountId: 'acc-1',
        userId: 'user-1',
        contactId: 'c-1',
        propertyId: 'p-1',
        text: 'Visit Sunday 11am',
      })
    ).resolves.toBe('failed');
  });
});
