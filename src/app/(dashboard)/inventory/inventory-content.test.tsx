// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InventoryContent from './inventory-content';

const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'acct-search-test',
  }),
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => true,
}));

vi.mock('@/hooks/use-locale', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: () => ({
      maybeSingle: async () => ({
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
      }),
    }),
    from: (table: string) => {
      if (table === 'showcase_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        };
      }
      if (table === 'property_portal_listings') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ data: [] }),
              }),
            }),
          }),
        };
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      };
    },
  }),
}));

vi.mock('@/components/inventory/portal-drift-panel', () => ({
  PortalDriftPanel: () => null,
}));

vi.mock('@/components/ui/locality-autocomplete', () => ({
  LocalityAutocomplete: () => <div data-testid="locality-autocomplete" />,
}));

vi.mock('@/components/inventory/property-list', () => ({
  PropertyList: () => <div data-testid="property-list" />,
}));

vi.mock('@/components/inventory/property-form', () => ({
  PropertyForm: () => null,
}));

vi.mock('@/components/inventory/flyer-creator-dialog', () => ({
  FlyerCreatorDialog: () => null,
}));

vi.mock('@/components/inventory/showcase-share-dialog', () => ({
  ShowcaseShareDialog: () => null,
}));

vi.mock('@/components/inventory/import-shared-dialog', () => ({
  ImportSharedDialog: () => null,
}));

vi.mock('@/components/inventory/property-email-share-dialog', () => ({
  PropertyEmailShareDialog: () => null,
}));

vi.mock('@/components/inventory/property-map-view', () => ({
  PropertyMapView: () => null,
}));

vi.mock('@/components/inventory/portal-post-dialog', () => ({
  PortalPostDialog: () => null,
}));

vi.mock('@/components/inventory/portal-sync-dialog', () => ({
  PortalSyncDialog: () => null,
}));

vi.mock('@/components/inventory/promote-property-dialog', () => ({
  PromotePropertyDialog: () => null,
}));

vi.mock('@/components/inventory/property-share-dialog', () => ({
  PropertyShareDialog: ({
    open,
    property,
    onOpenChange,
  }: {
    open: boolean;
    property: { id: string; title: string } | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    open && property ? (
      <div data-testid="property-share-dialog">
        {property.id}:{property.title}
        <button type="button" onClick={() => onOpenChange(false)}>
          Close share
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/inventory/gate-requests-drawer', () => ({
  GateRequestsDrawer: () => null,
}));

vi.mock('@/components/inventory/bulk-tag-bar', () => ({
  BulkTagBar: () => null,
}));

function renderInventory() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <InventoryContent />
    </QueryClientProvider>
  );
}

function mockPropertiesFetch(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/properties/property-1') {
      return {
        ok: true,
        json: async () => ({
          id: 'property-1',
          account_id: 'acct-search-test',
          title: 'Maple Villa',
          status: 'Available',
          listing_type: 'Sell',
          features: [],
          images: [],
        }),
      };
    }
    if (url.startsWith('/api/properties')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'property-1',
              account_id: 'acct-search-test',
              title: 'Maple Villa',
              price: 12000000,
              location: 'Bengaluru',
              city: 'Bengaluru',
              type: 'Villa',
              status: 'Available',
              listing_type: 'Sell',
              is_published: true,
              features: [],
              images: [],
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
          pagination: {
            total: 1,
            totalPages: 1,
          },
        }),
      };
    }
    if (url === '/api/properties/gate-stats') {
      return {
        ok: true,
        json: async () => ({ data: {} }),
      };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  });
}

const propertiesCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/properties?'));

beforeEach(() => {
  searchParams.delete('search');
  searchParams.delete('page');
  searchParams.delete('propertyId');
  searchParams.delete('sharePropertyId');
  searchParams.delete('copilotAction');
  window.history.replaceState(null, '', '/inventory');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('inventory search clear controls', () => {
  it('clears desktop search input and restores unfiltered results', async () => {
    const fetchMock = vi.fn();
    mockPropertiesFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    renderInventory();

    const searchInput = screen.getByPlaceholderText(
      'e.g. residential properties > 10 Cr, 3 BHK villa'
    ) as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: 'Maple' } });
    expect(searchInput.value).toBe('Maple');

    await waitFor(() => {
      const latestWithSearch = propertiesCalls(fetchMock).find((url) => {
        const params = new URLSearchParams(url.split('?')[1]);
        return params.get('search') === 'Maple';
      });
      expect(latestWithSearch).toBeTruthy();
    });

    const clearButton = screen.getByLabelText('Clear inventory search query');
    fireEvent.click(clearButton);

    await waitFor(() => {
      const latestNoSearch = propertiesCalls(fetchMock)
        .slice()
        .reverse()
        .find((url) => {
          const params = new URLSearchParams(url.split('?')[1]);
          return params.get('search') === null;
        });
      expect(latestNoSearch).toBeTruthy();
    });

    expect(searchInput.value).toBe('');
  });

  it('clears mobile search input inside the mobile panel', async () => {
    const fetchMock = vi.fn();
    mockPropertiesFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    renderInventory();

    fireEvent.click(screen.getByRole('button', { name: 'Search inventory' }));

    const mobileInput = screen.getByPlaceholderText(
      'e.g. residential properties > 10 Cr'
    ) as HTMLInputElement;
    fireEvent.change(mobileInput, { target: { value: 'Villa' } });
    expect(mobileInput.value).toBe('Villa');

    const mobileClearButton = screen.getByLabelText(
      'Clear mobile inventory search query'
    );
    fireEvent.click(mobileClearButton);

    expect(mobileInput.value).toBe('');
  });
});

describe('Copilot property share handoff', () => {
  it('opens the existing share dialog and consumes its action URL on close', async () => {
    searchParams.set('sharePropertyId', 'property-1');
    searchParams.set('copilotAction', '33333333-3333-4333-8333-333333333333');
    window.history.replaceState(
      null,
      '',
      '/inventory?sharePropertyId=property-1&copilotAction=33333333-3333-4333-8333-333333333333'
    );
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const fetchMock = vi.fn();
    mockPropertiesFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    renderInventory();

    expect(
      (await screen.findByTestId('property-share-dialog')).textContent
    ).toContain('property-1:Maple Villa');

    fireEvent.click(screen.getByRole('button', { name: 'Close share' }));

    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/inventory');
    expect(window.location.search).toBe('');
  });
});
