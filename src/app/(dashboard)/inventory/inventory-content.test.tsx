// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import InventoryPage from './inventory-content';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => true,
}));

vi.mock('@/hooks/use-locale', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/components/inventory/portal-drift-panel', () => ({
  PortalDriftPanel: () => null,
}));

vi.mock('@/components/inventory/property-form', () => ({
  PropertyForm: () => null,
}));

vi.mock('@/components/inventory/property-map-view', () => ({
  PropertyMapView: () => null,
}));

vi.mock('@/components/inventory/flyer-creator-dialog', () => ({
  FlyerCreatorDialog: () => null,
}));

vi.mock('@/components/inventory/promote-property-dialog', () => ({
  PromotePropertyDialog: () => null,
}));

vi.mock('@/components/inventory/property-share-dialog', () => ({
  PropertyShareDialog: () => null,
}));

vi.mock('@/components/inventory/import-shared-dialog', () => ({
  ImportSharedDialog: () => null,
}));

vi.mock('@/components/inventory/property-email-share-dialog', () => ({
  PropertyEmailShareDialog: () => null,
}));

vi.mock('@/components/inventory/showcase-share-dialog', () => ({
  ShowcaseShareDialog: () => null,
}));

vi.mock('@/components/inventory/portal-post-dialog', () => ({
  PortalPostDialog: () => null,
}));

vi.mock('@/components/inventory/portal-sync-dialog', () => ({
  PortalSyncDialog: () => null,
}));

vi.mock('@/components/inventory/bulk-tag-bar', () => ({
  BulkTagBar: () => null,
}));

vi.mock('@/components/inventory/gate-requests-drawer', () => ({
  GateRequestsDrawer: () => null,
}));

vi.mock('@/lib/supabase/client', () => {
  const withBuilder = () => {
    const builder: {
      data: never[];
      error: null;
      select: () => unknown;
      eq: () => unknown;
      in: () => unknown;
      maybeSingle: () => Promise<{ data: null; error: null }>;
    } = {
      data: [],
      error: null,
      select: () => null,
      eq: () => null,
      in: () => null,
      maybeSingle: async () => ({ data: null, error: null }),
    };

    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));

    return builder;
  };

  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === 'showcase_settings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          };
        }
        return withBuilder();
      },
      rpc: vi.fn(async () => ({
        data: {
          total: 0,
          published: 0,
          available: 0,
          sold_or_contract: 0,
          pending_review: 0,
          active_total: 0,
          direct: 0,
          agent_referred: 0,
        },
        error: null,
      })),
    }),
  };
});

function mockInventoryApi() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/portals/drift')) {
      return { ok: true, json: async () => ({ data: [] }) };
    }
    if (url.includes('/api/properties/gate-stats')) {
      return { ok: true, json: async () => ({ data: {} }) };
    }
    if (url.includes('/api/properties')) {
      return {
        ok: true,
        json: async () => ({
          data: [],
          pagination: { total: 0, totalPages: 0 },
        }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });

  vi.stubGlobal('fetch', fetchMock);
}

function renderInventory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <InventoryPage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Inventory search inputs', () => {
  it('shows a desktop clear icon inside the main search input', async () => {
    mockInventoryApi();

    renderInventory();

    const input = await screen.findByPlaceholderText(
      'e.g. residential properties > 10 Cr, 3 BHK villa'
    );
    fireEvent.change(input, { target: { value: 'villa' } });

    const clear = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clear);

    expect((input as HTMLInputElement).value).toBe('');
  });

  it('shows and clears the mobile search input with an inline X control', async () => {
    mockInventoryApi();

    renderInventory();

    fireEvent.click(screen.getByRole('button', { name: 'Search inventory' }));

    const input = await screen.findByPlaceholderText(
      'e.g. residential properties > 10 Cr'
    );
    fireEvent.change(input, { target: { value: 'flat' } });

    const clear = screen.getByRole('button', { name: 'Clear mobile search' });
    fireEvent.click(clear);

    expect((input as HTMLInputElement).value).toBe('');
  });
});
