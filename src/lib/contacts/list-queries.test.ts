import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { CONTACT_LIST_COLUMNS } from './list-columns';
import {
  CONTACTS_LOAD_TIMEOUT_MS,
  CONTACTS_PAGE_SIZE,
  loadContactsPage,
  type ContactListParams,
} from './list-queries';

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

interface TableResult {
  data: unknown;
  count?: number | null;
  error?: unknown;
}

const CHAIN_METHODS = [
  'select',
  'eq',
  'not',
  'in',
  'or',
  'lte',
  'order',
  'range',
  'limit',
  'contains',
  'ilike',
];

function stubDb(
  results: Record<string, TableResult>,
  tabCounts: Record<string, number> | null
) {
  const calls: Call[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const from = (table: string) => {
    const result = results[table] ?? { data: [] };
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) =>
      Promise.resolve({
        data: result.data,
        count: result.count ?? null,
        error: result.error ?? null,
      }).then(resolve, reject);
    return chain;
  };
  const rpc = (fn: string, args: unknown) => {
    rpcs.push({ fn, args });
    return { maybeSingle: async () => ({ data: tabCounts, error: null }) };
  };
  return { db: { from, rpc } as unknown as SupabaseClient, calls, rpcs };
}

const baseParams: ContactListParams = {
  accountId: 'acct-1',
  page: 2,
  tab: 'active',
  sort: 'created_desc',
  search: '',
  classification: 'All',
  tag: 'All',
  minBudget: 'All',
  maxBudget: 'All',
  areas: [],
  areaVariants: [],
  interestProperty: 'All',
  interestProject: 'All',
};

const TAB_COUNTS = {
  active: 40,
  pending_review: 3,
  favorites: 2,
  transacted: 1,
  market_active: 5,
  archived: 6,
};

const on = (calls: Call[], table: string) =>
  calls.filter((c) => c.table === table).map((c) => [c.method, ...c.args]);

describe('loadContactsPage', () => {
  it('scopes a plain active-tab page to the account, hides merged and chain-only rows, pages with range and reads the tab counts once', async () => {
    const { db, calls, rpcs } = stubDb(
      {
        profiles: { data: [] },
        contacts: { data: [{ id: 'c1' }, { id: 'c2' }], count: 57 },
        contact_tags: {
          data: [
            { contact_id: 'c1', tag_id: 't1' },
            { contact_id: 'c1', tag_id: 't2' },
          ],
        },
      },
      TAB_COUNTS
    );
    const areaOptions = vi.fn(async () => []);

    const page = await loadContactsPage(db, baseParams, areaOptions);

    const contacts = on(calls, 'contacts');
    expect(contacts).toContainEqual([
      'select',
      CONTACT_LIST_COLUMNS,
      { count: 'exact' },
    ]);
    expect(contacts).toContainEqual(['eq', 'account_id', 'acct-1']);
    expect(contacts).toContainEqual(['eq', 'is_merged', false]);
    expect(contacts).toContainEqual(['eq', 'chain_only', false]);
    expect(contacts).toContainEqual(['eq', 'is_archived', false]);
    expect(contacts).toContainEqual(['eq', 'status', 'active']);
    expect(contacts).toContainEqual([
      'order',
      'created_at',
      { ascending: false },
    ]);
    expect(contacts).toContainEqual([
      'range',
      2 * CONTACTS_PAGE_SIZE,
      3 * CONTACTS_PAGE_SIZE - 1,
    ]);
    expect(on(calls, 'deals')).toEqual([]);
    expect(areaOptions).not.toHaveBeenCalled();

    expect(rpcs).toEqual([
      { fn: 'contacts_tab_counts', args: { p_account_id: 'acct-1' } },
    ]);
    expect(on(calls, 'contact_tags')).toContainEqual([
      'in',
      'contact_id',
      ['c1', 'c2'],
    ]);

    expect(page.totalCount).toBe(57);
    expect(page.contacts.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(page.contactTagsByContact).toEqual({ c1: ['t1', 't2'] });
    expect(page.counts).toEqual({
      activeCount: 40,
      reviewCount: 3,
      favoritesCount: 2,
      transactedCount: 1,
      marketActiveCount: 5,
      archivedCount: 6,
    });
  });

  it('narrows the Transacted tab to contacts with a won deal', async () => {
    const { db, calls } = stubDb(
      {
        deals: {
          data: [
            { contact_id: 'c1' },
            { contact_id: 'c1' },
            { contact_id: null },
          ],
        },
        contacts: { data: [{ id: 'c1' }], count: 1 },
      },
      TAB_COUNTS
    );

    await loadContactsPage(
      db,
      { ...baseParams, tab: 'transacted' },
      async () => []
    );

    expect(on(calls, 'deals')).toEqual([
      ['select', 'contact_id'],
      ['eq', 'status', 'won'],
    ]);
    const contacts = on(calls, 'contacts');
    expect(contacts).toContainEqual(['eq', 'status', 'active']);
    expect(contacts).toContainEqual(['in', 'id', ['c1']]);
  });

  it('returns no rows for the Transacted tab when nothing has been won', async () => {
    const { db, calls } = stubDb(
      { deals: { data: [] }, contacts: { data: [], count: 0 } },
      TAB_COUNTS
    );

    const page = await loadContactsPage(
      db,
      { ...baseParams, tab: 'transacted' },
      async () => []
    );

    expect(on(calls, 'contacts')).toContainEqual([
      'eq',
      'id',
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(page.contacts).toEqual([]);
    expect(page.contactTagsByContact).toEqual({});
    expect(on(calls, 'contact_tags')).toEqual([]);
  });

  it('throws the query error instead of swallowing it', async () => {
    const { db } = stubDb(
      { contacts: { data: null, error: { message: 'boom' } } },
      TAB_COUNTS
    );

    await expect(
      loadContactsPage(db, baseParams, async () => [])
    ).rejects.toEqual({ message: 'boom' });
  });

  it('rejects after the deadline when a request never settles', async () => {
    vi.useFakeTimers();
    const hanging = {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const method of CHAIN_METHODS) chain[method] = () => chain;
        chain.then = () => undefined;
        return chain;
      },
      rpc: () => ({ maybeSingle: () => new Promise(() => undefined) }),
    } as unknown as SupabaseClient;
    const result = loadContactsPage(hanging, baseParams, async () => []);
    const settled = result.then(
      () => 'resolved',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(CONTACTS_LOAD_TIMEOUT_MS);
    expect(await settled).toBe('contacts fetch timed out after 20s');
  });
});

afterEach(() => {
  vi.useRealTimers();
});
