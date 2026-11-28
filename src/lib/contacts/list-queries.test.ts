import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TypedSupabaseClient } from '@/lib/supabase/database';

import { CONTACT_SORTS } from './contact-sorts';
import { CONTACT_LIST_COLUMNS } from './list-columns';
import {
  CONTACT_LIST_SELECT,
  CONTACTS_LOAD_TIMEOUT_MS,
  CONTACTS_PAGE_SIZE,
  loadContactTabCounts,
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

const LISTABLE = 'contacts_listable';
const LISTABLE_TAGGED = 'contacts_listable_tagged';
const TAG_ID = '11111111-2222-4333-8444-555555555555';

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
  const rpcs: { fn: string; args: unknown; options?: unknown }[] = [];
  const from = (table: string) => {
    const result = results[table === LISTABLE_TAGGED ? LISTABLE : table] ?? {
      data: [],
    };
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
  const rpc = (fn: string, args: unknown, options?: unknown) => {
    rpcs.push({ fn, args, options });
    if (fn === LISTABLE || fn === LISTABLE_TAGGED) return from(fn);
    return { maybeSingle: async () => ({ data: tabCounts, error: null }) };
  };
  return { db: { from, rpc } as unknown as TypedSupabaseClient, calls, rpcs };
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
  it('[CTM-022] loads an active-tab page, its exact count and its tag ids in one contacts_listable request', async () => {
    const { db, calls, rpcs } = stubDb(
      {
        [LISTABLE]: {
          data: [
            {
              id: 'c1',
              contact_tags: [{ tag_id: 't1' }, { tag_id: 't2' }],
            },
            { id: 'c2', contact_tags: [] },
          ],
          count: 57,
        },
      },
      TAB_COUNTS
    );
    const areaOptions = vi.fn(async () => []);

    const page = await loadContactsPage(db, baseParams, areaOptions);

    expect(rpcs).toEqual([
      {
        fn: LISTABLE,
        args: { p_account_id: 'acct-1' },
        options: { count: 'exact' },
      },
    ]);
    const list = on(calls, LISTABLE);
    expect(list).toContainEqual(['select', CONTACT_LIST_SELECT]);
    expect(list).toContainEqual(['eq', 'is_archived', false]);
    expect(list).toContainEqual(['eq', 'status', 'active']);
    expect(list).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(list).toContainEqual([
      'range',
      2 * CONTACTS_PAGE_SIZE,
      3 * CONTACTS_PAGE_SIZE - 1,
    ]);
    expect(calls.map((c) => c.table)).toEqual(calls.map(() => LISTABLE));
    expect(areaOptions).not.toHaveBeenCalled();

    expect(page.totalCount).toBe(57);
    expect(page.contacts).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    expect(page.contactTagsByContact).toEqual({ c1: ['t1', 't2'] });
  });

  it('[CTM-022] filters by tag inside contacts_listable_tagged, never through an id list', async () => {
    const { db, calls, rpcs } = stubDb(
      { [LISTABLE]: { data: [{ id: 'c1', contact_tags: null }], count: 1 } },
      TAB_COUNTS
    );

    const page = await loadContactsPage(
      db,
      { ...baseParams, tag: TAG_ID },
      async () => []
    );

    expect(rpcs).toEqual([
      {
        fn: LISTABLE_TAGGED,
        args: { p_account_id: 'acct-1', p_tag_id: TAG_ID },
        options: { count: 'exact' },
      },
    ]);
    expect(on(calls, 'contact_tags')).toEqual([]);
    expect(page.contacts).toEqual([{ id: 'c1' }]);
    expect(page.contactTagsByContact).toEqual({});
  });

  it('[CTM-022] returns no rows for a tag filter that is not a tag id', async () => {
    const { db, calls, rpcs } = stubDb(
      { [LISTABLE]: { data: [], count: 0 } },
      TAB_COUNTS
    );

    await loadContactsPage(
      db,
      { ...baseParams, tag: 'not-a-tag' },
      async () => []
    );

    expect(rpcs.map((r) => r.fn)).toEqual([LISTABLE]);
    expect(on(calls, LISTABLE)).toContainEqual([
      'eq',
      'id',
      '00000000-0000-0000-0000-000000000000',
    ]);
  });

  it('[CTM-022] selects every column the list can be sorted by, since the function is projected before it is ordered', async () => {
    const columns = CONTACT_LIST_COLUMNS.split(',').map((c) => c.trim());
    const sorts = [...CONTACT_SORTS.map((s) => s.value), 'last_contacted_asc'];
    for (const sort of sorts) {
      const { db, calls } = stubDb(
        { [LISTABLE]: { data: [], count: 0 } },
        TAB_COUNTS
      );
      await loadContactsPage(db, { ...baseParams, sort }, async () => []);
      const ordered = on(calls, LISTABLE).filter(([m]) => m === 'order');
      expect(ordered).toHaveLength(1);
      expect(columns).toContain(ordered[0][1]);
    }
    expect(CONTACT_LIST_SELECT).toBe(
      `${CONTACT_LIST_COLUMNS}, contact_tags(tag_id)`
    );
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
        [LISTABLE]: { data: [{ id: 'c1' }], count: 1 },
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
    const contacts = on(calls, LISTABLE);
    expect(contacts).toContainEqual(['eq', 'status', 'active']);
    expect(contacts).toContainEqual(['in', 'id', ['c1']]);
  });

  it('returns no rows for the Transacted tab when nothing has been won', async () => {
    const { db, calls } = stubDb(
      { deals: { data: [] }, [LISTABLE]: { data: [], count: 0 } },
      TAB_COUNTS
    );

    const page = await loadContactsPage(
      db,
      { ...baseParams, tab: 'transacted' },
      async () => []
    );

    expect(on(calls, LISTABLE)).toContainEqual([
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
      { [LISTABLE]: { data: null, error: { message: 'boom' } } },
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
      rpc: () => {
        const chain: Record<string, unknown> = {};
        for (const method of CHAIN_METHODS) chain[method] = () => chain;
        chain.then = () => undefined;
        return chain;
      },
    } as unknown as TypedSupabaseClient;
    const result = loadContactsPage(hanging, baseParams, async () => []);
    const settled = result.then(
      () => 'resolved',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(CONTACTS_LOAD_TIMEOUT_MS);
    expect(await settled).toBe('contacts fetch timed out after 20s');
  });
});

describe('loadContactTabCounts', () => {
  it('[CTM-022] reads the six counters from contacts_tab_counts, apart from the list', async () => {
    const { db, calls, rpcs } = stubDb({}, TAB_COUNTS);

    const counts = await loadContactTabCounts(db, 'acct-1');

    expect(rpcs).toEqual([
      {
        fn: 'contacts_tab_counts',
        args: { p_account_id: 'acct-1' },
        options: undefined,
      },
    ]);
    expect(calls).toEqual([]);
    expect(counts).toEqual({
      activeCount: 40,
      reviewCount: 3,
      favoritesCount: 2,
      transactedCount: 1,
      marketActiveCount: 5,
      archivedCount: 6,
    });
  });

  it('throws when the aggregate fails, so the tabs keep their plain labels', async () => {
    const db = {
      rpc: () => ({
        maybeSingle: async () => ({ data: null, error: { message: 'nope' } }),
      }),
    } as unknown as TypedSupabaseClient;

    await expect(loadContactTabCounts(db, 'acct-1')).rejects.toEqual({
      message: 'nope',
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});
