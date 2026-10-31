import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

/**
 * Query cache persisted to AsyncStorage = the offline READ story
 * (see the plan's "Offline & Connectivity Strategy": no WatermelonDB,
 * no hand-rolled sync). Cached inbox/contacts render offline; realtime
 * and refetches take over when connectivity returns.
 *
 * MMKV is the faster backend but needs a dev build (native module) —
 * swap the persister when EAS dev builds land in Phase 2.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000, // keep a week of offline data
      retry: 2,
    },
  },
});

if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) =>
      handleFocus(state === 'active')
    );
    return () => subscription.remove();
  });
}

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'convoreal-query-cache',
});

/**
 * Cached query data is JSON, so anything a queryFn returns must survive a
 * round trip through JSON.stringify — no Set, Map or Date. Bump this when a
 * cached shape changes so restored entries from older builds are discarded
 * instead of reaching components that expect the new shape.
 */
export const queryCacheBuster = '3';
