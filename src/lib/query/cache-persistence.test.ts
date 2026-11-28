// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  PERSISTED_QUERY_PREFIXES,
  QUERY_CACHE_MAX_AGE_MS,
  applyPersistedQueryDefaults,
  clearPersistedQueryCaches,
  isPersistedQueryKey,
  queryCacheStorageKey,
  startQueryCachePersistence,
} from './cache-persistence';

function newClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  applyPersistedQueryDefaults(client);
  return client;
}

async function flushPersister() {
  await vi.advanceTimersByTimeAsync(1_500);
}

function stored(userId: string) {
  const raw = window.localStorage.getItem(queryCacheStorageKey(userId));
  return raw
    ? (JSON.parse(raw) as {
        buster: string;
        clientState: { queries: { queryKey: unknown[] }[] };
      })
    : null;
}

function storedBlob(queryKey: unknown[], data: unknown, timestamp: number) {
  return JSON.stringify({
    buster: 'build-a',
    timestamp,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey,
          queryHash: JSON.stringify(queryKey),
          state: {
            data,
            dataUpdatedAt: timestamp,
            status: 'success',
            fetchStatus: 'idle',
          },
        },
      ],
    },
  });
}

describe('[ACC-011] web query cache persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists only the allow-listed list queries', () => {
    expect(PERSISTED_QUERY_PREFIXES).toEqual([
      ['contacts', 'list'],
      ['contacts', 'tab-counts'],
      ['contacts', 'tags'],
      ['inventory', 'list'],
      ['inventory', 'overview'],
      ['inventory', 'match-counts'],
      ['calendar'],
    ]);
    expect(isPersistedQueryKey(['contacts', 'list', { page: 0 }])).toBe(true);
    expect(isPersistedQueryKey(['contacts', 'tags'])).toBe(true);
    expect(isPersistedQueryKey(['calendar', 'acct-1', '2026-11'])).toBe(true);
    expect(isPersistedQueryKey(['inventory', 'match-contacts', 'acct-1'])).toBe(
      false
    );
    expect(isPersistedQueryKey(['calendar-pickers', 'acct-1'])).toBe(false);
    expect(isPersistedQueryKey(['contacts'])).toBe(false);
    expect(isPersistedQueryKey(['inbox', 'list'])).toBe(false);
  });

  it('writes successful allow-listed queries under the signed-in user and skips the rest', async () => {
    const client = newClient();
    const stop = startQueryCachePersistence(client, 'user-1', 'build-a');
    await flushPersister();

    client.setQueryData(['contacts', 'list', { page: 0 }], { contacts: [1] });
    client.setQueryData(['inventory', 'match-contacts', 'acct-1'], [1, 2, 3]);
    await client
      .fetchQuery({
        queryKey: ['inventory', 'list', 'page=0'],
        queryFn: () => Promise.reject(new Error('offline')),
      })
      .catch(() => {});
    await flushPersister();

    const blob = stored('user-1');
    expect(blob?.buster).toBe('build-a');
    expect(blob?.clientState.queries.map((q) => q.queryKey)).toEqual([
      ['contacts', 'list', { page: 0 }],
    ]);
    stop();
  });

  it('restores a stored copy for the same user and build, and nothing for another build', async () => {
    const first = newClient();
    const stopFirst = startQueryCachePersistence(first, 'user-1', 'build-a');
    await flushPersister();
    first.setQueryData(['calendar', 'acct-1'], { appointments: ['visit'] });
    await flushPersister();
    stopFirst();

    const sameUser = newClient();
    const stopSame = startQueryCachePersistence(sameUser, 'user-1', 'build-a');
    await flushPersister();
    expect(sameUser.getQueryData(['calendar', 'acct-1'])).toEqual({
      appointments: ['visit'],
    });
    stopSame();

    const newBuild = newClient();
    const stopBuild = startQueryCachePersistence(newBuild, 'user-1', 'build-b');
    await flushPersister();
    expect(newBuild.getQueryData(['calendar', 'acct-1'])).toBeUndefined();
    stopBuild();
  });

  it("never restores another user's copy and deletes it from the browser", async () => {
    window.localStorage.setItem(
      queryCacheStorageKey('user-1'),
      storedBlob(
        ['calendar', 'acct-1'],
        { appointments: ['visit'] },
        Date.now()
      )
    );
    const otherUser = newClient();
    const stop = startQueryCachePersistence(otherUser, 'user-2', 'build-a');
    await flushPersister();
    expect(otherUser.getQueryData(['calendar', 'acct-1'])).toBeUndefined();
    expect(window.localStorage.getItem(queryCacheStorageKey('user-1'))).toBe(
      null
    );
    stop();
  });

  it('discards a stored copy older than a day', async () => {
    window.localStorage.setItem(
      queryCacheStorageKey('user-1'),
      storedBlob(
        ['contacts', 'tags'],
        { t1: { id: 't1' } },
        Date.now() - QUERY_CACHE_MAX_AGE_MS - 1_000
      )
    );
    const client = newClient();
    const stop = startQueryCachePersistence(client, 'user-1', 'build-a');
    await flushPersister();
    expect(client.getQueryData(['contacts', 'tags'])).toBeUndefined();
    stop();
  });

  it('keeps allow-listed queries in memory for the restore window and leaves the rest at the default', () => {
    const client = newClient();
    expect(client.getQueryDefaults(['contacts', 'list', { page: 2 }])).toEqual({
      gcTime: QUERY_CACHE_MAX_AGE_MS,
    });
    expect(
      client.getQueryDefaults(['inventory', 'match-contacts', 'acct-1'])
    ).toEqual({});
  });

  it('wipes every stored copy on sign-out and leaves other keys alone', () => {
    window.localStorage.setItem(queryCacheStorageKey('user-1'), '{}');
    window.localStorage.setItem(queryCacheStorageKey('user-2'), '{}');
    window.localStorage.setItem('theme', 'violet');
    clearPersistedQueryCaches();
    expect(window.localStorage.getItem(queryCacheStorageKey('user-1'))).toBe(
      null
    );
    expect(window.localStorage.getItem(queryCacheStorageKey('user-2'))).toBe(
      null
    );
    expect(window.localStorage.getItem('theme')).toBe('violet');
  });

  it('does not write a queued copy back after persistence stops', async () => {
    const client = newClient();
    const stop = startQueryCachePersistence(client, 'user-1', 'build-a');
    await flushPersister();

    client.setQueryData(['contacts', 'list', { page: 0 }], { contacts: [1] });
    stop();
    client.clear();
    clearPersistedQueryCaches();
    await flushPersister();

    expect(stored('user-1')).toBeNull();
  });

  it('degrades to no persistence when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const client = newClient();
    const stop = startQueryCachePersistence(client, 'user-1', 'build-a');
    await flushPersister();
    client.setQueryData(['contacts', 'tags'], { t1: { id: 't1' } });
    await flushPersister();
    expect(client.getQueryData(['contacts', 'tags'])).toEqual({
      t1: { id: 't1' },
    });
    expect(() => clearPersistedQueryCaches()).not.toThrow();
    stop();
  });
});
