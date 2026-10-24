import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Queued {
  data?: unknown;
  error?: { message: string } | null;
}

let queues: Record<string, Queued[]>;
let calls: Array<{ table: string; method: string; args: unknown[] }>;
let rpcCalls: Array<{ fn: string; args: unknown }>;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? {
        data: null,
        error: null,
      };
      const builder: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of [
        'select',
        'eq',
        'in',
        'not',
        'order',
        'upsert',
        'insert',
      ]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (resolve: unknown, reject: unknown) =>
        Promise.resolve(response).then(
          resolve as (v: unknown) => unknown,
          reject as (v: unknown) => unknown
        );
      return builder;
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return fn === 'journey_show_captured'
        ? { data: (args as { p_item_ids: string[] }).p_item_ids, error: null }
        : { data: null, error: null };
    },
  }),
}));

import { captureJourneyItems, leadInterestOnlyHiddenIds } from './capture';

const STAGES = [{ id: 'stage-new', name: 'New Inquiry', position: 0 }];

beforeEach(() => {
  queues = {};
  calls = [];
  rpcCalls = [];
});

describe('[JRN-026] leadInterestOnlyHiddenIds', () => {
  it('keeps the hidden items only a lead’s yes captured and nobody reviewed', async () => {
    queues.journey_events = [
      {
        data: [
          {
            item_id: 'lead-only',
            event_type: 'added',
            reason: 'Captured from lead interest',
          },
          {
            item_id: 'reviewed',
            event_type: 'added',
            reason: 'Captured from lead interest',
          },
          { item_id: 'reviewed', event_type: 'unhidden', reason: null },
          { item_id: 'reviewed', event_type: 'hidden', reason: null },
          {
            item_id: 'share',
            event_type: 'added',
            reason: 'Captured from WhatsApp share',
          },
        ],
        error: null,
      },
    ];

    const ids = await leadInterestOnlyHiddenIds('acc-1', [
      { id: 'lead-only', hidden: true },
      { id: 'reviewed', hidden: true },
      { id: 'share', hidden: true },
      { id: 'visible', hidden: false },
    ]);

    expect([...ids]).toEqual(['lead-only']);
    expect(
      calls.find((c) => c.table === 'journey_events' && c.method === 'in')?.args
    ).toEqual(['event_type', ['added', 'hidden', 'unhidden']]);
  });

  it('asks nothing when no item is hidden', async () => {
    const ids = await leadInterestOnlyHiddenIds('acc-1', [
      { id: 'visible', hidden: false },
    ]);
    expect(ids.size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('[JRN-009] [JRN-026] captureJourneyItems', () => {
  it('shows a pair only a lead’s yes captured through the reviewed-show function', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [
      { data: [], error: null },
      {
        data: [{ id: 'lead-only', contact_id: 'c-1', property_id: 'p-1' }],
        error: null,
      },
    ];
    queues.journey_events = [
      {
        data: [
          {
            item_id: 'lead-only',
            event_type: 'added',
            reason: 'Captured from lead interest',
          },
        ],
        error: null,
      },
    ];

    const result = await captureJourneyItems({
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'inquiry_import',
      hidden: false,
    });

    expect(result).toEqual({ created: 0, shown: 1, error: null });
    expect(rpcCalls.filter((c) => c.fn === 'journey_show_captured')).toEqual([
      {
        fn: 'journey_show_captured',
        args: { p_account_id: 'acc-1', p_item_ids: ['lead-only'] },
      },
    ]);
  });

  it('leaves a hidden share capture alone and reports nothing new', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [
      { data: [], error: null },
      {
        data: [{ id: 'share', contact_id: 'c-1', property_id: 'p-1' }],
        error: null,
      },
    ];
    queues.journey_events = [
      {
        data: [
          {
            item_id: 'share',
            event_type: 'added',
            reason: 'Captured from WhatsApp share',
          },
        ],
        error: null,
      },
    ];

    const result = await captureJourneyItems({
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'manual',
      hidden: false,
    });

    expect(result).toEqual({ created: 0, shown: 0, error: null });
    expect(rpcCalls.filter((c) => c.fn === 'journey_show_captured')).toEqual(
      []
    );
  });

  it('never shows anything for a hidden capture', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [{ data: [], error: null }];

    const result = await captureJourneyItems({
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'whatsapp_share',
      hidden: true,
    });

    expect(result).toEqual({ created: 0, shown: 0, error: null });
    expect(calls.filter((c) => c.table === 'journey_events')).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'journey_show_captured')).toEqual(
      []
    );
  });
});
