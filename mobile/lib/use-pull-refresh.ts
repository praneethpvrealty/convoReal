import { useState } from 'react';

/**
 * Pull-to-refresh state that is true ONLY while the user is actually
 * pulling.
 *
 * Wiring `RefreshControl` straight to react-query's `isFetching` looks
 * right until something refetches on its own: invalidating after a
 * mutation, or a refocus, drops a spinner over the list that the user
 * never asked for and cannot dismiss, for as long as the query takes.
 * On a multi-round-trip list that reads as the screen hanging.
 *
 * `refetch()` from react-query never rejects — it resolves with the
 * error on the result — so the flag always clears.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return { refreshing, onRefresh };
}
