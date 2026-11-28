import {
  defaultShouldDehydrateQuery,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

export const QUERY_CACHE_STORAGE_PREFIX = 'convoreal-query-cache:';

export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const PERSISTED_QUERY_PREFIXES: readonly QueryKey[] = [
  ['contacts', 'list'],
  ['contacts', 'tab-counts'],
  ['contacts', 'tags'],
  ['inventory', 'list'],
  ['inventory', 'overview'],
  ['inventory', 'match-counts'],
  ['calendar'],
];

export function isPersistedQueryKey(queryKey: QueryKey): boolean {
  return PERSISTED_QUERY_PREFIXES.some(
    (prefix) =>
      queryKey.length >= prefix.length &&
      prefix.every((part, index) => queryKey[index] === part)
  );
}

export function shouldPersistQuery(query: Query): boolean {
  return (
    isPersistedQueryKey(query.queryKey) &&
    query.state.status === 'success' &&
    defaultShouldDehydrateQuery(query)
  );
}

export function queryCacheStorageKey(userId: string): string {
  return `${QUERY_CACHE_STORAGE_PREFIX}${userId}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return browserStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      browserStorage()?.setItem(key, value);
    } catch {
      try {
        browserStorage()?.removeItem(key);
      } catch {}
    }
  },
  removeItem: (key: string): void => {
    try {
      browserStorage()?.removeItem(key);
    } catch {}
  },
};

export function clearPersistedQueryCaches(keepUserId?: string): void {
  try {
    const storage = browserStorage();
    if (!storage) return;
    const keep = keepUserId ? queryCacheStorageKey(keepUserId) : null;
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(QUERY_CACHE_STORAGE_PREFIX) && key !== keep) {
        stale.push(key);
      }
    }
    stale.forEach((key) => storage.removeItem(key));
  } catch {}
}

export function applyPersistedQueryDefaults(client: QueryClient): void {
  for (const prefix of PERSISTED_QUERY_PREFIXES) {
    client.setQueryDefaults(prefix, { gcTime: QUERY_CACHE_MAX_AGE_MS });
  }
}

export function startQueryCachePersistence(
  client: QueryClient,
  userId: string,
  buster: string
): () => void {
  clearPersistedQueryCaches(userId);
  const [unsubscribe, restored] = persistQueryClient({
    queryClient: client,
    persister: createAsyncStoragePersister({
      storage: safeStorage,
      key: queryCacheStorageKey(userId),
    }),
    buster,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
      shouldDehydrateMutation: () => false,
    },
  });
  restored.catch(() => {});
  return unsubscribe;
}
