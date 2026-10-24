import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureJourneyItems,
  captureReasonForSource,
  ensureJourneyItem,
  loadJourneyStages,
} from './capture-server';

interface Queued {
  data?: unknown;
  error?: { message: string } | null;
}

let queues: Record<string, Queued[]>;
let writes: Array<{
  table: string;
  op: 'insert' | 'upsert' | 'update';
  row: unknown;
}>;
let rpcCalls: Array<{ fn: string; args: unknown }>;
let stagesRpcSeeds: Queued[];

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? {
        data: null,
        error: null,
      };
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        insert: (row: unknown) => {
          writes.push({ table, op: 'insert', row });
          return builder;
        },
        upsert: (row: unknown) => {
          writes.push({ table, op: 'upsert', row });
          return builder;
        },
        update: (row: unknown) => {
          writes.push({ table, op: 'update', row });
          return builder;
        },
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(response).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      const seeded = stagesRpcSeeds.shift();
      if (seeded) queues.journey_stages = [seeded];
      return { data: null, error: null };
    }),
  } as never;
}

const STAGES = [
  { id: 'stage-new', name: 'New Inquiry', position: 0 },
  { id: 'stage-visit', name: 'Site Visit Scheduled', position: 2 },
];

beforeEach(() => {
  queues = {};
  writes = [];
  rpcCalls = [];
  stagesRpcSeeds = [];
});

describe('[JRN-009] loadJourneyStages', () => {
  it('mirrors the default board when the account has no stages yet', async () => {
    queues.journey_stages = [{ data: [], error: null }];
    stagesRpcSeeds = [{ data: STAGES, error: null }];

    const stages = await loadJourneyStages(makeDb(), 'acc-1');

    expect(rpcCalls).toEqual([
      { fn: 'journey_stages_for_account', args: { p_account_id: 'acc-1' } },
    ]);
    expect(stages).toEqual(STAGES);
  });
});

describe('[JRN-009] captureJourneyItems', () => {
  it('creates each new pair at the first stage and logs its added event', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [
      { data: [{ id: 'item-1' }, { id: 'item-2' }], error: null },
    ];

    const result = await captureJourneyItems(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [
        { contactId: 'c-1', propertyId: 'p-1' },
        { contactId: 'c-2', propertyId: 'p-1' },
        { contactId: 'c-1', propertyId: 'p-1' },
      ],
      source: 'whatsapp_share',
      hidden: true,
    });

    expect(result).toEqual({ created: 2, error: null });
    expect(writes[0]).toEqual({
      table: 'journey_items',
      op: 'upsert',
      row: [
        {
          account_id: 'acc-1',
          contact_id: 'c-1',
          property_id: 'p-1',
          stage_id: 'stage-new',
          source: 'whatsapp_share',
          hidden: true,
          created_by: 'user-1',
        },
        {
          account_id: 'acc-1',
          contact_id: 'c-2',
          property_id: 'p-1',
          stage_id: 'stage-new',
          source: 'whatsapp_share',
          hidden: true,
          created_by: 'user-1',
        },
      ],
    });
    expect(writes[1]).toEqual({
      table: 'journey_events',
      op: 'insert',
      row: [
        {
          account_id: 'acc-1',
          item_id: 'item-1',
          event_type: 'added',
          to_stage_id: 'stage-new',
          reason: 'Captured from WhatsApp share',
          created_by: 'user-1',
        },
        {
          account_id: 'acc-1',
          item_id: 'item-2',
          event_type: 'added',
          to_stage_id: 'stage-new',
          reason: 'Captured from WhatsApp share',
          created_by: 'user-1',
        },
      ],
    });
  });

  it('leaves pairs already on the journey untouched and logs nothing for them', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [{ data: [], error: null }];

    const result = await captureJourneyItems(makeDb(), {
      accountId: 'acc-1',
      userId: null,
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'whatsapp_share',
      hidden: false,
    });

    expect(result).toEqual({ created: 0, error: null });
    expect(writes.map((w) => w.table)).toEqual(['journey_items']);
  });

  it('reports a database failure instead of masquerading as nothing new', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [{ data: null, error: { message: 'boom' } }];

    const result = await captureJourneyItems(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'whatsapp_share',
      hidden: true,
    });

    expect(result).toEqual({ created: 0, error: 'boom' });
  });

  it('names the capture after its source', () => {
    expect(captureReasonForSource('whatsapp_share')).toBe(
      'Captured from WhatsApp share'
    );
    expect(captureReasonForSource('chat_import')).toBe(
      'Imported from chat history'
    );
    expect(captureReasonForSource('inquiry_import')).toBe(
      'Imported from property inquiries'
    );
    expect(captureReasonForSource('manual')).toBe('Added manually');
  });
});

describe('[JRN-009] ensureJourneyItem', () => {
  it('returns an existing pair as is, whatever its stage or visibility', async () => {
    queues.journey_items = [
      {
        data: { id: 'item-9', stage_id: 'stage-visit', status: 'dropped' },
        error: null,
      },
    ];

    const item = await ensureJourneyItem(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      contactId: 'c-1',
      propertyId: 'p-1',
      source: 'chat_import',
      hidden: false,
      reason: 'Captured from visit request',
    });

    expect(item).toEqual({
      id: 'item-9',
      stage_id: 'stage-visit',
      status: 'dropped',
    });
    expect(writes).toEqual([]);
  });

  it('captures a new pair at the first stage with the given reason', async () => {
    queues.journey_items = [
      { data: null, error: null },
      {
        data: [{ id: 'item-1', stage_id: 'stage-new', status: 'active' }],
        error: null,
      },
    ];

    const item = await ensureJourneyItem(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      contactId: 'c-1',
      propertyId: 'p-1',
      source: 'chat_import',
      hidden: false,
      reason: 'Captured from visit request',
      stages: STAGES,
    });

    expect(item).toEqual({
      id: 'item-1',
      stage_id: 'stage-new',
      status: 'active',
    });
    expect(writes).toEqual([
      {
        table: 'journey_items',
        op: 'upsert',
        row: {
          account_id: 'acc-1',
          contact_id: 'c-1',
          property_id: 'p-1',
          stage_id: 'stage-new',
          source: 'chat_import',
          hidden: false,
          created_by: 'user-1',
        },
      },
      {
        table: 'journey_events',
        op: 'insert',
        row: {
          account_id: 'acc-1',
          item_id: 'item-1',
          event_type: 'added',
          to_stage_id: 'stage-new',
          reason: 'Captured from visit request',
          created_by: 'user-1',
        },
      },
    ]);
  });
});
