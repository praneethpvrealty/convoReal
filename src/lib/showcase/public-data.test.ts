import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cachedFetchShowcaseData } from './public-data';

const state = {
  propertyCount: 1,
  propertyUpdatedAt: '2026-07-28T10:00:00Z',
  settingsUpdatedAt: '2026-07-01T10:00:00Z',
  accountUpdatedAt: '2026-07-02T10:00:00Z',
  accountName: 'Aryavarta Ventures',
  images: ['old.jpg'],
  catalogueFetches: 0,
};

vi.mock('@/lib/automations/admin-client', () => {
  const builder = (table: string) => {
    let isVersionProbe = false;

    const self = {
      select: (_columns: string, options?: { count?: string }) => {
        isVersionProbe = options?.count === 'exact';
        return self;
      },
      eq: () => self,
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
              : { updated_at: state.settingsUpdatedAt },
          error: null,
        }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'properties' && !isVersionProbe) state.catalogueFetches++;
        return Promise.resolve({
          data:
            table === 'properties'
              ? [{ id: 'prop-1', images: state.images }]
              : [],
          error: null,
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

    state.accountName = 'Aryavarta Realty';
    state.accountUpdatedAt = '2026-07-31T09:00:00Z';
    const second = await cachedFetchShowcaseData('acc-renamed', false);

    expect(state.catalogueFetches).toBe(2);
    expect(second.accountName).toBe('Aryavarta Realty');
  });
});
