"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Server-cache layer for the dashboard's client components.
 *
 * The app fetches from ~150 hand-rolled `useEffect` + `fetch` blocks,
 * each with its own loading/error/refetch state. Two components asking
 * for the same data issue two requests, and every navigation back to a
 * page refetches from scratch. React Query dedupes in-flight requests,
 * serves cached data across navigation, and owns the loading state.
 *
 * The client is created inside `useState` rather than at module scope:
 * a module-level client is shared across requests on the server, which
 * leaks one user's cached data into another's render.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Dashboard data is aggregate and tolerates being seconds
            // stale; this is what stops a tab-switch from refetching
            // everything. Matches the mobile app's queryClient.
            staleTime: 30 * 1000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
