import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DenContext } from './auth';
import { valuedSummary } from './value-view';

interface Call {
  table: string;
  op: 'select' | 'delete' | 'upsert';
  filters: Array<[string, string, unknown]>;
  payload?: unknown;
}

let tables: Record<string, Record<string, unknown>[]>;
let calls: Call[];
let embedOptions: Array<[string, string]>;

function makeDb(): SupabaseClient {
  return {
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: (_c: string, o?: { referencedTable?: string }) => (
          o?.referencedTable && embedOptions.push(['order', o.referencedTable]),
          builder
        ),
        limit: (_n: number, o?: { referencedTable?: string }) => (
          o?.referencedTable && embedOptions.push(['limit', o.referencedTable]),
          builder
        ),
        delete: () => ((call.op = 'delete'), builder),
        upsert: (payload: unknown) => (
          (call.op = 'upsert'),
          (call.payload = payload),
          builder
        ),
        eq: (c: string, v: unknown) => (
          call.filters.push(['eq', c, v]),
          builder
        ),
        neq: (c: string, v: unknown) => (
          call.filters.push(['neq', c, v]),
          builder
        ),
        gte: (c: string, v: unknown) => (
          call.filters.push(['gte', c, v]),
          builder
        ),
        in: (c: string, v: unknown) => (
          call.filters.push(['in', c, v]),
          builder
        ),
        maybeSingle: () =>
          Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: call.op === 'select' ? rows() : null,
            error: null,
          }).then(resolve),
      };
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          call.filters.every(([op, column, value]) => {
            if (column.includes('.')) return true;
            if (op === 'eq') return row[column] === value;
            if (op === 'neq') return row[column] !== value;
            if (op === 'in') return (value as unknown[]).includes(row[column]);
            if (op === 'gte') return String(row[column]) >= String(value);
            return true;
          })
        );
      return builder;
    },
  } as unknown as SupabaseClient;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => makeDb() }));

const { loadOwnerPortfolioValue, saveOwnerDeclaredValue } =
  await import('./value');

const NOW = new Date('2026-11-11T00:00:00Z');

const ctx = (links: Array<[string, string]>): DenContext => ({
  userId: 'u1',
  denUserId: 'den-1',
  phone: '+919900000000',
  displayName: null,
  notifyMatches: true,
  notifyBids: true,
  digestFrequency: 'weekly',
  links: links.map(([accountId, contactId]) => ({
    linkId: `l-${contactId}`,
    accountId,
    contactId,
    agencyName: `Agency ${accountId}`,
  })),
});

const property = (over: Record<string, unknown>) => ({
  id: 'p1',
  account_id: 'acct-a',
  owner_contact_id: 'c-a',
  listing_source: 'owner',
  title: 'Flat',
  status: 'Available',
  listing_type: 'Rent',
  price: null,
  city: 'Bangalore',
  sublocality: 'Whitefield',
  locality_canonical: null,
  type: 'Apartment',
  area_sqft: 1000,
  declared: null,
  guidance: [],
  ...over,
});

const cell = {
  side: 'supply',
  listing_type: 'sale',
  period_month: '2026-10-01',
  city: 'bengaluru',
  locality: 'whitefield',
  property_type: 'apartment',
  priced_count: 6,
  median_price_per_sqft: 9000,
  p25_price_per_sqft: 8000,
  p75_price_per_sqft: 10000,
};

beforeEach(() => {
  calls = [];
  embedOptions = [];
  tables = {
    properties: [],
    accounts: [],
    market_stats: [cell],
    owner_property_values: [],
  };
});

describe('loadOwnerPortfolioValue', () => {
  it('[PVL-004] reads nothing for an owner with no linked contact', async () => {
    const result = await loadOwnerPortfolioValue(ctx([]), makeDb(), NOW);
    expect(result.properties).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("[PVL-004] returns only the caller's own listings", async () => {
    tables.properties = [
      property({ id: 'mine' }),
      property({ id: 'someone-else', owner_contact_id: 'c-other' }),
      property({ id: 'agent-referred', listing_source: 'agent' }),
      property({ id: 'other-account', account_id: 'acct-z' }),
    ];
    const result = await loadOwnerPortfolioValue(
      ctx([['acct-a', 'c-a']]),
      makeDb(),
      NOW
    );
    expect(result.properties.map((p) => p.property_id)).toEqual(['mine']);
    const query = calls.find((c) => c.table === 'properties');
    expect(query?.filters).toContainEqual(['in', 'owner_contact_id', ['c-a']]);
    expect(query?.filters).toContainEqual(['neq', 'listing_source', 'agent']);
  });

  it("[PVL-003] reads only the figure the caller set, never another owner's", async () => {
    tables.properties = [property({})];
    await loadOwnerPortfolioValue(ctx([['acct-a', 'c-a']]), makeDb(), NOW);
    const query = calls.find((c) => c.table === 'properties');
    expect(query?.filters).toContainEqual([
      'eq',
      'declared.den_user_id',
      'den-1',
    ]);
  });

  it('[PVL-001] orders and limits the guidance embed by its alias', async () => {
    tables.properties = [property({})];
    await loadOwnerPortfolioValue(ctx([['acct-a', 'c-a']]), makeDb(), NOW);
    expect(embedOptions).toEqual([
      ['order', 'guidance'],
      ['limit', 'guidance'],
    ]);
  });

  it('[PVL-001] says so when an owner has more properties than it counts', async () => {
    tables.properties = Array.from({ length: 101 }, (_, i) =>
      property({ id: `p${i}` })
    );
    const result = await loadOwnerPortfolioValue(
      ctx([['acct-a', 'c-a']]),
      makeDb(),
      NOW
    );
    expect(result.truncated).toBe(true);
    expect(result.properties).toHaveLength(100);
    expect(valuedSummary(result.totals, result.truncated)).toContain(
      'most recent properties'
    );
  });

  it('[PVL-004] shows a market range only under an agency that shares data', async () => {
    tables.accounts = [
      { id: 'acct-a', data_sharing_consent: true },
      { id: 'acct-b', data_sharing_consent: false },
    ];
    tables.properties = [
      property({ id: 'shared' }),
      property({
        id: 'private',
        account_id: 'acct-b',
        owner_contact_id: 'c-b',
      }),
    ];
    const result = await loadOwnerPortfolioValue(
      ctx([
        ['acct-a', 'c-a'],
        ['acct-b', 'c-b'],
      ]),
      makeDb(),
      NOW
    );
    const byId = new Map(result.properties.map((p) => [p.property_id, p]));
    expect(byId.get('shared')?.market).toMatchObject({
      low: 8_000_000,
      mid: 9_000_000,
      high: 10_000_000,
      comparables: 6,
    });
    expect(byId.get('private')?.market).toBeNull();
  });

  it('[PVL-004] never queries market cells when no agency shares data', async () => {
    tables.accounts = [{ id: 'acct-a', data_sharing_consent: false }];
    tables.properties = [property({})];
    await loadOwnerPortfolioValue(ctx([['acct-a', 'c-a']]), makeDb(), NOW);
    expect(calls.some((c) => c.table === 'market_stats')).toBe(false);
  });

  it('[PVL-003] leaves a sold property out and reads the saved figures', async () => {
    tables.properties = [
      property({
        id: 'kept',
        declared: { declared_value: '12500000' },
        guidance: [{ total_value: '6000000', created_at: '2026-10-02' }],
      }),
      property({ id: 'sold', status: 'Sold', listing_type: 'Sale' }),
    ];
    const result = await loadOwnerPortfolioValue(
      ctx([['acct-a', 'c-a']]),
      makeDb(),
      NOW
    );
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0]).toMatchObject({
      property_id: 'kept',
      declared: 12_500_000,
      guidance: { total: 6_000_000, saved_at: '2026-10-02' },
      estimate: 12_500_000,
      estimate_source: 'declared',
    });
    expect(result.totals).toMatchObject({ properties: 1, valued: 1 });
  });
});

describe('saveOwnerDeclaredValue', () => {
  it('[PVL-003] refuses a property the caller does not own and writes nothing', async () => {
    tables.properties = [property({ id: 'p1', owner_contact_id: 'c-other' })];
    const outcome = await saveOwnerDeclaredValue(
      ctx([['acct-a', 'c-a']]),
      'p1',
      9_000_000,
      makeDb()
    );
    expect(outcome).toBe('not_found');
    expect(calls.some((c) => c.table === 'owner_property_values')).toBe(false);
  });

  it("[PVL-003] saves under the property's account and the caller's identity", async () => {
    tables.properties = [property({ id: 'p1' })];
    const outcome = await saveOwnerDeclaredValue(
      ctx([['acct-a', 'c-a']]),
      'p1',
      9_000_000,
      makeDb()
    );
    expect(outcome).toBe('saved');
    const write = calls.find((c) => c.table === 'owner_property_values');
    expect(write?.op).toBe('upsert');
    expect(write?.payload).toMatchObject({
      account_id: 'acct-a',
      property_id: 'p1',
      den_user_id: 'den-1',
      declared_value: 9_000_000,
    });
  });

  it('[PVL-003] clears the figure for that property only', async () => {
    tables.properties = [property({ id: 'p1' })];
    const outcome = await saveOwnerDeclaredValue(
      ctx([['acct-a', 'c-a']]),
      'p1',
      null,
      makeDb()
    );
    expect(outcome).toBe('cleared');
    const write = calls.find((c) => c.table === 'owner_property_values');
    expect(write?.op).toBe('delete');
    expect(write?.filters).toEqual([
      ['eq', 'property_id', 'p1'],
      ['eq', 'den_user_id', 'den-1'],
    ]);
  });
});
