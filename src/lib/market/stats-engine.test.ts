import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { median, normalizeToken, runMarketStats } from './stats-engine';
import { DEFAULT_MARKET_STATS_CONFIG } from './stats-config';

// ── In-memory Supabase mock (image-cleanup.test.ts pattern): filters run
// against plain arrays; delete/insert mutate them so tests assert real
// end state. ───────────────────────────────────────────────────────────
interface Store {
  accounts: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  market_stats: Record<string, unknown>[];
}

function makeAdmin(store: Store): SupabaseClient {
  const build = (table: keyof Store) => {
    const b: Record<string, unknown> & {
      _eq: Record<string, unknown>;
      _in: Record<string, unknown[]>;
      _gte: Record<string, string>;
      _op: 'select' | 'insert' | 'delete';
      _rows: Record<string, unknown>[] | null;
    } = {
      _eq: {},
      _in: {},
      _gte: {},
      _op: 'select',
      _rows: null,
      select: () => b,
      insert: (rows: Record<string, unknown>[]) => {
        b._op = 'insert';
        b._rows = rows;
        return b;
      },
      delete: () => {
        b._op = 'delete';
        return b;
      },
      eq: (c: string, v: unknown) => ((b._eq[c] = v), b),
      in: (c: string, v: unknown[]) => ((b._in[c] = v), b),
      gte: (c: string, v: string) => ((b._gte[c] = v), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(res, rej),
    };
    const matches = (row: Record<string, unknown>) => {
      for (const [c, v] of Object.entries(b._eq)) if (row[c] !== v) return false;
      for (const [c, vals] of Object.entries(b._in)) if (!vals.includes(row[c])) return false;
      for (const [c, v] of Object.entries(b._gte))
        if (!(typeof row[c] === 'string' && (row[c] as string) >= v)) return false;
      return true;
    };
    const exec = () => {
      if (b._op === 'insert') {
        store[table].push(...(b._rows ?? []));
        return { data: null, error: null };
      }
      if (b._op === 'delete') {
        store[table] = store[table].filter((r) => !matches(r));
        return { error: null };
      }
      return { data: store[table].filter(matches), error: null };
    };
    return b;
  };
  return { from: (t: string) => build(t as keyof Store) } as unknown as SupabaseClient;
}

const NOW = new Date('2026-07-12T10:00:00.000Z');
const THIS_MONTH = '2026-07';

function account(id: string, consent = true) {
  return { id, data_sharing_consent: consent };
}

function property(accountId: string, over: Record<string, unknown> = {}) {
  return {
    account_id: accountId,
    city: 'Bengaluru',
    sublocality: 'Whitefield',
    locality_canonical: null,
    type: 'Apartment',
    listing_type: 'Sale',
    price: 8_000_000,
    area_sqft: 1200,
    status: 'Available',
    sold_price: null,
    created_at: `${THIS_MONTH}-05T00:00:00.000Z`,
    status_changed_at: `${THIS_MONTH}-05T00:00:00.000Z`,
    ...over,
  };
}

const cfg = (over: Partial<typeof DEFAULT_MARKET_STATS_CONFIG> = {}) => ({
  ...DEFAULT_MARKET_STATS_CONFIG,
  enabled: true,
  ...over,
});

let store: Store;
beforeEach(() => {
  store = { accounts: [], properties: [], contacts: [], market_stats: [] };
});

describe('median / normalizeToken', () => {
  it('computes odd and even medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('normalizes case and whitespace', () => {
    expect(normalizeToken('  White Field ')).toBe('white field');
    expect(normalizeToken('WHITEFIELD')).toBe('whitefield');
    expect(normalizeToken('   ')).toBeNull();
    expect(normalizeToken(null)).toBeNull();
  });
});

describe('runMarketStats — consent gating', () => {
  it('does nothing when no account has consented', async () => {
    store.accounts = [account('a1', false)];
    store.properties = [property('a1')];
    const summary = await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    expect(summary.consentingAccounts).toBe(0);
    expect(store.market_stats).toHaveLength(0);
  });

  it("never counts a non-consenting account's rows", async () => {
    store.accounts = [account('a1', true), account('a2', false)];
    store.properties = [property('a1'), property('a2'), property('a2')];
    const summary = await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    expect(summary.consentingAccounts).toBe(1);
    const cell = store.market_stats.find((r) => r.side === 'supply');
    expect(cell?.listings_count).toBe(1); // only a1's listing
    expect(cell?.accounts_count).toBe(1);
  });
});

describe('runMarketStats — k-anonymity', () => {
  const seedAccounts = (n: number) => {
    for (let i = 1; i <= n; i++) {
      store.accounts.push(account(`a${i}`));
      store.properties.push(property(`a${i}`));
    }
  };

  it('suppresses a cell backed by 4 accounts when K=5', async () => {
    seedAccounts(4);
    const summary = await runMarketStats(makeAdmin(store), cfg(), NOW);
    expect(summary.suppressedCells).toBe(1);
    expect(summary.supplyCells).toBe(0);
    expect(store.market_stats).toHaveLength(0);
  });

  it('publishes the same cell once a 5th account contributes', async () => {
    seedAccounts(5);
    const summary = await runMarketStats(makeAdmin(store), cfg(), NOW);
    expect(summary.supplyCells).toBe(1);
    expect(summary.suppressedCells).toBe(0);
    expect(store.market_stats[0]).toMatchObject({
      city: 'bengaluru',
      locality: 'whitefield',
      accounts_count: 5,
      listings_count: 5,
    });
  });

  it('K counts distinct accounts, not listings', async () => {
    // One prolific account with 10 listings must still be suppressed.
    store.accounts = [account('a1')];
    for (let i = 0; i < 10; i++) store.properties.push(property('a1'));
    const summary = await runMarketStats(makeAdmin(store), cfg(), NOW);
    expect(summary.suppressedCells).toBe(1);
    expect(store.market_stats).toHaveLength(0);
  });
});

describe('runMarketStats — supply metrics', () => {
  it('prefers locality_canonical and falls back to sublocality', async () => {
    store.accounts = [account('a1')];
    store.properties = [
      property('a1', { locality_canonical: 'Whitefield, Bengaluru' }),
      property('a1', { locality_canonical: null, sublocality: 'HSR Layout' }),
    ];
    await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    const localities = store.market_stats.map((r) => r.locality).sort();
    expect(localities).toEqual(['hsr layout', 'whitefield, bengaluru']);
  });

  it('computes sold metrics from status_changed_at and sold_price', async () => {
    store.accounts = [account('a1')];
    store.properties = [
      property('a1', {
        status: 'Sold',
        sold_price: 7_500_000,
        created_at: '2026-06-20T00:00:00.000Z',
        status_changed_at: `${THIS_MONTH}-10T00:00:00.000Z`, // 20 days later
      }),
    ];
    await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    const cell = store.market_stats.find(
      (r) => r.side === 'supply' && r.period_month === `${THIS_MONTH}-01`,
    );
    expect(cell?.sold_count).toBe(1);
    expect(cell?.median_sold_price).toBe(7_500_000);
    expect(cell?.median_days_to_sell).toBe(20);
  });

  it('skips rows with no usable geography', async () => {
    store.accounts = [account('a1')];
    store.properties = [property('a1', { city: null }), property('a1', { sublocality: null })];
    const summary = await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    expect(summary.supplyCells).toBe(0);
    expect(store.market_stats).toHaveLength(0);
  });
});

describe('runMarketStats — demand', () => {
  it('normalizes and dedupes areas, computes budget midpoint', async () => {
    store.accounts = [account('a1')];
    store.contacts = [
      {
        account_id: 'a1',
        status: 'active',
        min_budget: 6_000_000,
        max_budget: 8_000_000,
        pref_budget_min: null,
        pref_budget_max: null,
        areas_of_interest: ['Whitefield ', 'WHITEFIELD'],
        pref_areas: ['whitefield'],
        property_interests: ['Apartment'],
        pref_property_types: null,
      },
    ];
    await runMarketStats(makeAdmin(store), cfg({ k_threshold: 1 }), NOW);
    const demand = store.market_stats.filter((r) => r.side === 'demand');
    expect(demand).toHaveLength(1); // three spellings → one cell
    expect(demand[0]).toMatchObject({
      city: 'all',
      locality: 'whitefield',
      property_type: 'apartment',
      buyer_count: 1,
      median_budget: 7_000_000,
    });
  });
});

describe('runMarketStats — replace semantics', () => {
  it('is idempotent: a second run does not duplicate cells', async () => {
    store.accounts = [account('a1')];
    store.properties = [property('a1')];
    const admin = makeAdmin(store);
    await runMarketStats(admin, cfg({ k_threshold: 1 }), NOW);
    await runMarketStats(admin, cfg({ k_threshold: 1 }), NOW);
    expect(store.market_stats.filter((r) => r.side === 'supply')).toHaveLength(1);
  });

  it('drops previously-published cells after consent withdrawal', async () => {
    store.accounts = [account('a1')];
    store.properties = [property('a1')];
    const admin = makeAdmin(store);
    await runMarketStats(admin, cfg({ k_threshold: 1 }), NOW);
    expect(store.market_stats).toHaveLength(1);

    (store.accounts[0] as { data_sharing_consent: boolean }).data_sharing_consent = false;
    await runMarketStats(admin, cfg({ k_threshold: 1 }), NOW);
    expect(store.market_stats).toHaveLength(0); // window replaced, cell gone
  });
});
