// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const db = vi.hoisted(() => ({
  propertiesError: null as { message: string } | null,
}));

function chain(result: () => unknown): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown
        ) => Promise.resolve(result()).then(resolve, reject);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) =>
      chain(() =>
        table === 'properties'
          ? db.propertiesError
            ? { data: null, error: db.propertiesError }
            : {
                data: [{ id: 'p1', title: 'Lake View', property_code: 'P1' }],
                error: null,
              }
          : { data: [], error: null }
      ),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    accountId: 'a1',
    profile: { full_name: 'Praneeth', phone: '919900000000' },
  }),
}));

import { ShowcaseShareDialog } from './showcase-share-dialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  db.propertiesError = null;
});

function renderDialog(initialPickedIds?: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ShowcaseShareDialog
        open
        onOpenChange={vi.fn()}
        accountId="a1"
        showcaseSettings={null}
        initialPickedIds={initialPickedIds}
      />
    </QueryClientProvider>
  );
}

describe('[UIX-044] ShowcaseShareDialog surfaces failures', () => {
  it('[UIX-044] says when the listings to share failed to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      )
    );
    db.propertiesError = { message: 'timeout' };
    renderDialog();

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Failed to load listings to share'
      )
    );
  });

  it('[UIX-044] says when the share could not be saved on the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url) === '/api/showcase-shares'
            ? { ok: false, json: () => Promise.resolve({ error: 'boom' }) }
            : { ok: true, json: () => Promise.resolve({}) }
        )
      )
    );
    renderDialog(['p1']);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Could not save this share on the server — the link still opens the showcase.'
      )
    );
  });
});
