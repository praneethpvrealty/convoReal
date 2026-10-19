import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cachedFetchShowcaseData,
  cachedResolveSharePinnedIds,
  splitShowcaseListings,
  toPublicProperties,
} from './public-data';
import type { Property } from '@/types';

const state = {
  propertyCount: 1,
  propertyUpdatedAt: '2026-07-28T10:00:00Z',
  settingsUpdatedAt: '2026-07-01T10:00:00Z',
  accountUpdatedAt: '2026-07-02T10:00:00Z',
  accountName: 'Aryavarta Ventures',
  images: ['old.jpg'],
  catalogueFetches: 0,
  catalogueError: null as Error | null,
  orFilters: [] as string[],
  shareLookups: [] as Array<Record<string, unknown>>,
  sharePinnedIds: null as string[] | null,
  shareError: null as Error | null,
};

vi.mock('@/lib/supabase/admin', () => {
  const builder = (table: string) => {
    let isVersionProbe = false;

    const self = {
      select: (_columns: string, options?: { count?: string }) => {
        isVersionProbe = options?.count === 'exact';
        return self;
      },
      eq: (column: string, value: unknown) => {
        if (table === 'showcase_share_links') {
          state.shareLookups.push({ [column]: value });
        }
        return self;
      },
      in: () => self,
      or: (filter: string) => {
        state.orFilters.push(filter);
        return self;
      },
      order: () => self,
      limit: () =>
        Promise.resolve({
          data: [{ updated_at: state.propertyUpdatedAt }],
          count: state.propertyCount,
          error: null,
        }),
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === 'accounts'
              ? { name: state.accountName, updated_at: state.accountUpdatedAt }
              : table === 'showcase_share_links'
                ? state.shareError
                  ? null
                  : { pinned_ids: state.sharePinnedIds }
                : { updated_at: state.settingsUpdatedAt },
          error: table === 'showcase_share_links' ? state.shareError : null,
        }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'properties' && !isVersionProbe) state.catalogueFetches++;
        return Promise.resolve({
          data:
            table === 'properties'
              ? state.catalogueError
                ? null
                : [
                    { id: 'prop-1', status: 'Available', images: state.images },
                    { id: 'prop-2', status: 'Under Contract', images: [] },
                  ]
              : [],
          error: table === 'properties' ? state.catalogueError : null,
        }).then(resolve);
      },
    };
    return self;
  };

  return { supabaseAdmin: () => ({ from: (table: string) => builder(table) }) };
});

// Stand-in for the Next.js data cache, keyed the way unstable_cache keys
// entries (callback identity + keyParts + arguments) — a key that fails to
// move here is a showcase that keeps serving yesterday's photos.
vi.mock('next/cache', () => {
  const store = new Map<string, unknown>();
  return {
    unstable_cache:
      (cb: (...args: unknown[]) => Promise<unknown>, keyParts: string[]) =>
      async (...args: unknown[]) => {
        const key = `${cb.toString()}-${keyParts.join(',')}-${JSON.stringify(args)}`;
        if (!store.has(key)) store.set(key, await cb(...args));
        return store.get(key);
      },
  };
});

describe('cachedFetchShowcaseData', () => {
  beforeEach(() => {
    state.catalogueFetches = 0;
    state.catalogueError = null;
  });

  it('serves repeat visits from cache while nothing changes', async () => {
    await cachedFetchShowcaseData('acc-unchanged', false);
    await cachedFetchShowcaseData('acc-unchanged', false);

    expect(state.catalogueFetches).toBe(1);
  });

  it('refetches as soon as a listing is edited', async () => {
    await cachedFetchShowcaseData('acc-edited', false);
    state.propertyUpdatedAt = '2026-07-30T16:17:14Z';
    state.images = ['new.jpg'];

    const result = await cachedFetchShowcaseData('acc-edited', false);

    expect(state.catalogueFetches).toBe(2);
    expect(result.properties[0].images).toEqual(['new.jpg']);
  });

  it('refetches when a listing is published or removed', async () => {
    await cachedFetchShowcaseData('acc-published', false);
    state.propertyCount = 2;

    await cachedFetchShowcaseData('acc-published', false);

    expect(state.catalogueFetches).toBe(2);
  });

  it('refetches when showcase settings change', async () => {
    await cachedFetchShowcaseData('acc-settings', false);
    state.settingsUpdatedAt = '2026-07-30T17:00:00Z';

    await cachedFetchShowcaseData('acc-settings', false);

    expect(state.catalogueFetches).toBe(2);
  });

  it('serves the brand name from the account, and refetches on rename', async () => {
    const first = await cachedFetchShowcaseData('acc-renamed', false);
    expect(first.accountName).toBe('Aryavarta Ventures');

    state.accountName = 'Aryavarta Ventures';
    state.accountUpdatedAt = '2026-07-31T09:00:00Z';
    const second = await cachedFetchShowcaseData('acc-renamed', false);

    expect(state.catalogueFetches).toBe(2);
    expect(second.accountName).toBe('Aryavarta Ventures');
  });

  it('does not cache a failed catalogue query as an empty showcase', async () => {
    state.catalogueError = new Error('database temporarily unavailable');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(
      cachedFetchShowcaseData('acc-transient-failure', false)
    ).rejects.toThrow('Failed to load public showcase properties');

    state.catalogueError = null;
    const recovered = await cachedFetchShowcaseData(
      'acc-transient-failure',
      false
    );

    expect(state.catalogueFetches).toBe(2);
    expect(recovered.properties).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load public showcase properties:',
      expect.objectContaining({ accountId: 'acc-transient-failure' })
    );
    consoleError.mockRestore();
  });
});

describe('showcase audience', () => {
  beforeEach(() => {
    state.orFilters = [];
  });

  it('[PRP-046] the co-broker catalogue read withholds buyers-only rows in SQL', async () => {
    await cachedFetchShowcaseData('acc-audience-agent', true);
    expect(state.orFilters).toEqual([
      'showcase_audience.is.null,showcase_audience.neq.buyers_only',
    ]);
  });

  it('[PRP-046] the buyer catalogue read is unfiltered', async () => {
    await cachedFetchShowcaseData('acc-audience-buyer', false);
    expect(state.orFilters).toEqual([]);
  });

  it('[PRP-046] the public reducer drops a buyers-only row for the co-broker view before it can be serialized', () => {
    const rows = [
      { id: 'quiet', type: 'Apartment', showcase_audience: 'buyers_only' },
      { id: 'open', type: 'Apartment' },
    ] as unknown as Property[];
    expect(toPublicProperties(rows, [], [], true).map((p) => p.id)).toEqual([
      'open',
    ]);
    expect(toPublicProperties(rows, [], [], false).map((p) => p.id)).toEqual([
      'quiet',
      'open',
    ]);
  });
});

describe('cachedResolveSharePinnedIds', () => {
  const SHARE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    state.shareLookups = [];
    state.sharePinnedIds = null;
    state.shareError = null;
  });

  it('[PRP-005] a failed lookup fails closed instead of opening the whole catalogue', async () => {
    state.shareError = new Error('connection reset');
    await expect(
      cachedResolveSharePinnedIds('acc-outage', SHARE)
    ).rejects.toThrow('connection reset');
  });

  it('[PRP-005] returns the listings the share pinned, scoped to the account', async () => {
    state.sharePinnedIds = ['PROP-2263', 'PROP-2249'];
    await expect(
      cachedResolveSharePinnedIds('acc-pins', SHARE)
    ).resolves.toEqual(['PROP-2263', 'PROP-2249']);
    expect(state.shareLookups).toEqual([
      { id: SHARE },
      { account_id: 'acc-pins' },
    ]);
  });

  it('[PRP-005] a plain tracking token or a token from another account pins nothing', async () => {
    await expect(
      cachedResolveSharePinnedIds('acc-plain', SHARE)
    ).resolves.toEqual([]);
  });

  it('never queries for a token that is not a uuid', async () => {
    await expect(
      cachedResolveSharePinnedIds('acc-garbage', 'PROP-1,PROP-2')
    ).resolves.toEqual([]);
    expect(state.shareLookups).toEqual([]);
  });
});

describe('splitShowcaseListings', () => {
  it('[PRP-016] keeps under-contract listings apart from the available catalogue', () => {
    const { properties, underContract } = splitShowcaseListings([
      { id: 'a', status: 'Available' },
      { id: 'u', status: 'Under Contract' },
      { id: 's', status: 'Sold' },
    ] as never);
    expect(properties.map((p) => p.id)).toEqual(['a']);
    expect(underContract.map((p) => p.id)).toEqual(['u']);
  });

  it('[PRP-016] serves under-contract listings beside the catalogue without widening it', async () => {
    const data = await cachedFetchShowcaseData('acct-split', false);
    expect(data.properties.map((p) => p.id)).toEqual(['prop-1']);
    expect(data.underContract.map((p) => p.id)).toEqual(['prop-2']);
  });
});
