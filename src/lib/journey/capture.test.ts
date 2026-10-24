import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Queued {
  data?: unknown;
  error?: { message: string } | null;
}

let queues: Record<string, Queued[]>;
let calls: Array<{ table: string; method: string; args: unknown[] }>;
let rpcCalls: Array<{ fn: string; args: unknown }>;
let leadOnlyRows: Array<{
  id: string;
  contact_id: string;
  property_id: string;
}>;
let rpcError: string | null;

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
      if (fn === 'journey_show_captured') {
        return {
          data: (args as { p_item_ids: string[] }).p_item_ids,
          error: null,
        };
      }
      if (fn === 'journey_lead_interest_only_hidden') {
        return rpcError
          ? { data: null, error: { message: rpcError } }
          : { data: leadOnlyRows, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import { captureJourneyItems, leadInterestOnlyHidden } from './capture';

const STAGES = [{ id: 'stage-new', name: 'New Inquiry', position: 0 }];

beforeEach(() => {
  queues = {};
  calls = [];
  rpcCalls = [];
  leadOnlyRows = [];
  rpcError = null;
});

describe('[JRN-026] leadInterestOnlyHidden', () => {
  it('asks the account-scoped function for the subject, never shipping item ids', async () => {
    leadOnlyRows = [{ id: 'lead-only', contact_id: 'c-1', property_id: 'p-1' }];
    const rows = await leadInterestOnlyHidden('acc-1', {
      contactIds: ['c-1'],
    });
    expect(rows).toEqual(leadOnlyRows);
    expect(rpcCalls).toEqual([
      {
        fn: 'journey_lead_interest_only_hidden',
        args: {
          p_account_id: 'acc-1',
          p_contact_ids: ['c-1'],
          p_property_ids: null,
        },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it('asks nothing for an empty scope', async () => {
    expect(await leadInterestOnlyHidden('acc-1', { propertyIds: [] })).toEqual(
      []
    );
    expect(rpcCalls).toEqual([]);
  });
});

describe('[JRN-009] [JRN-026] captureJourneyItems', () => {
  it('shows a pair only a lead’s yes captured through the reviewed-show function', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [{ data: [], error: null }];
    leadOnlyRows = [
      { id: 'lead-only', contact_id: 'c-1', property_id: 'p-1' },
      { id: 'other-pair', contact_id: 'c-1', property_id: 'p-9' },
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
    queues.journey_items = [{ data: [], error: null }];
    leadOnlyRows = [];

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

  it('[JRN-026] reports a failed lookup instead of calling the pair already on the journey', async () => {
    queues.journey_stages = [{ data: STAGES, error: null }];
    queues.journey_items = [{ data: [], error: null }];
    rpcError = 'function unavailable';

    const result = await captureJourneyItems({
      accountId: 'acc-1',
      userId: 'user-1',
      pairs: [{ contactId: 'c-1', propertyId: 'p-1' }],
      source: 'manual',
      hidden: false,
    });

    expect(result).toEqual({
      created: 0,
      shown: 0,
      error: 'function unavailable',
    });
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
    expect(
      rpcCalls.filter((c) => c.fn !== 'sync_journey_stages_from_pipeline')
    ).toEqual([]);
  });
});
