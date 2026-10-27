// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }
// ============================================================
// "Add to my inventory" on the open listing and on every grid card —
// offered to a signed-in member of another brokerage, and to nobody
// else. One credentialed probe to the app origin covers the whole
// catalog, because a tenant showcase runs on its own subdomain and the
// session cookie does not, and a per-card probe would cost a request
// per listing.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const IMPORT_URL = 'https://www.convoreal.com/api/inventory/showcase-import';

type Viewer = { own: boolean; canImport: boolean; importedId: string | null };

const probe = vi.hoisted(() => ({
  status: 200,
  viewer: { own: false, canImport: true, importedId: null } as Viewer,
  rejections: 0,
  importStatus: 201,
  importBody: { data: { id: 'copy-1', title: 'Sarjapur JV Land' } } as unknown,
}));

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith(IMPORT_URL)) {
    if (init?.method === 'POST') {
      return Promise.resolve({
        ok: probe.importStatus < 400,
        status: probe.importStatus,
        json: () => Promise.resolve(probe.importBody),
      });
    }
    if (probe.rejections > 0) {
      probe.rejections -= 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const ids = (new URL(url).searchParams.get('property_ids') ?? '')
      .split(',')
      .filter(Boolean);
    return Promise.resolve({
      ok: probe.status < 400,
      status: probe.status,
      json: () =>
        Promise.resolve({
          data: {
            viewers: Object.fromEntries(ids.map((id) => [id, probe.viewer])),
          },
        }),
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: [] }),
  });
});
vi.stubGlobal('fetch', fetchMock);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: () => null,
}));
vi.mock('@/components/showcase/showcase-lead-bot', () => ({
  ShowcaseLeadBot: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));

import { toast } from 'sonner';
import { ShowcaseView } from './showcase-view';

const property = {
  id: 'prop-1',
  account_id: 'acct-1',
  title: 'Sarjapur JV Land',
  price: 220000000,
  location: 'Sarjapur, Bangalore',
  sublocality: 'Sarjapur',
  city: 'Bangalore',
  type: 'Residential Land/ Plot',
  status: 'Available',
  listing_type: 'Sale',
  is_published: true,
  features: [],
  images: [],
  property_code: 'CR-001',
  location_guarded: true,
  location_revealed: false,
  private_images_revealed: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

const second = {
  ...property,
  id: 'prop-2',
  title: 'Whitefield Apartment',
  type: 'Apartment',
  property_code: 'CR-002',
  location_guarded: false,
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderShowcase({
  open = true,
  agentMode = false,
  dealFloor = false,
  mapDiscovery = false,
  extra = [],
}: {
  open?: boolean;
  agentMode?: boolean;
  dealFloor?: boolean;
  mapDiscovery?: boolean;
  extra?: Property[];
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ShowcaseView
        properties={[property, second, ...extra]}
        settings={settings}
        accountId="acct-1"
        initialPropertyId={open ? property.id : undefined}
        initialAgentMode={agentMode}
        showcaseStyle={
          dealFloor ? 'deal-floor' : mapDiscovery ? 'map-discovery' : undefined
        }
        disableSavedState
      />
    </QueryClientProvider>
  );
}

function probeCalls() {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).startsWith(IMPORT_URL) && init?.method !== 'POST'
  );
}

function importCalls() {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).startsWith(IMPORT_URL) && init?.method === 'POST'
  );
}

const chipButton = () =>
  screen.queryByRole('button', {
    name: /add this property to your inventory/i,
  });
const chipLink = () =>
  screen.queryByRole('link', { name: 'In your inventory' });
const cardButton = (title: string) =>
  screen.queryByRole('button', { name: `Add ${title} to my inventory` });
const cardLink = (title: string) =>
  screen.queryByRole('link', { name: `${title} is in your inventory` });

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function closeOpenListing() {
  const close = Array.from(document.querySelectorAll('button')).find((b) =>
    b.querySelector('svg.lucide-x')
  );
  if (!close) throw new Error('open listing has no close button');
  fireEvent.click(close);
}

beforeEach(() => {
  probe.status = 200;
  probe.viewer = { own: false, canImport: true, importedId: null };
  probe.rejections = 0;
  probe.importStatus = 201;
  probe.importBody = { data: { id: 'copy-1', title: 'Sarjapur JV Land' } };
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('showcase — add to my inventory', () => {
  it('[PRP-053] asks the app origin once, with credentials, about the whole catalog', async () => {
    renderShowcase();
    await waitFor(() => expect(chipButton()).toBeTruthy());
    expect(probeCalls()).toHaveLength(1);
    const [url, init] = probeCalls()[0];
    expect(String(url)).toBe(`${IMPORT_URL}?property_ids=prop-1,prop-2`);
    expect(init?.credentials).toBe('include');
  });

  it('[PRP-053] offers the control on the open listing and on every grid card, in the buyer view and the co-broker view alike', async () => {
    renderShowcase();
    await waitFor(() => expect(chipButton()).toBeTruthy());
    expect(cardButton('Sarjapur JV Land')).toBeTruthy();
    expect(cardButton('Whitefield Apartment')).toBeTruthy();
    cleanup();
    fetchMock.mockClear();

    renderShowcase({ agentMode: true });
    await waitFor(() => expect(chipButton()).toBeTruthy());
    expect(cardButton('Whitefield Apartment')).toBeTruthy();
  });

  it('[PRP-053] adds the open listing with one tap and links its chip and its card to the copy', async () => {
    renderShowcase();
    await waitFor(() => expect(chipButton()).toBeTruthy());

    fireEvent.click(chipButton()!);

    await waitFor(() => expect(chipLink()).toBeTruthy());
    const [url, init] = importCalls()[0];
    expect(String(url)).toBe(IMPORT_URL);
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(String(init?.body))).toEqual({ property_id: 'prop-1' });
    expect(chipLink()!.getAttribute('href')).toBe(
      'https://www.convoreal.com/inventory?propertyId=copy-1'
    );
    expect(cardLink('Sarjapur JV Land')!.getAttribute('href')).toBe(
      'https://www.convoreal.com/inventory?propertyId=copy-1'
    );
    expect(chipButton()).toBeNull();
    expect(cardButton('Whitefield Apartment')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/added to your inventory/i)
    );
  });

  it('[PRP-053] adds a listing straight from its grid card without opening it', async () => {
    probe.importBody = {
      data: { id: 'copy-2', title: 'Whitefield Apartment' },
    };
    renderShowcase({ open: false });
    await waitFor(() =>
      expect(cardButton('Whitefield Apartment')).toBeTruthy()
    );

    fireEvent.click(cardButton('Whitefield Apartment')!);

    await waitFor(() => expect(cardLink('Whitefield Apartment')).toBeTruthy());
    expect(JSON.parse(String(importCalls()[0][1]?.body))).toEqual({
      property_id: 'prop-2',
    });
    expect(cardLink('Whitefield Apartment')!.getAttribute('href')).toBe(
      'https://www.convoreal.com/inventory?propertyId=copy-2'
    );
    expect(cardButton('Sarjapur JV Land')).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Whitefield Apartment' })
    ).toBeNull();
  });

  it('[PRP-053] shows the copy this account already holds instead of the add control', async () => {
    probe.viewer = { own: false, canImport: true, importedId: 'copy-old' };
    renderShowcase();
    await waitFor(() => expect(chipLink()).toBeTruthy());
    expect(cardLink('Whitefield Apartment')).toBeTruthy();
    expect(chipButton()).toBeNull();
    expect(cardButton('Whitefield Apartment')).toBeNull();
  });

  it('[PRP-053] surfaces the refusal when the import fails', async () => {
    probe.importStatus = 403;
    probe.importBody = {
      error: 'This listing is confidential and cannot be imported',
    };
    renderShowcase({ open: false });
    await waitFor(() =>
      expect(cardButton('Whitefield Apartment')).toBeTruthy()
    );

    fireEvent.click(cardButton('Whitefield Apartment')!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This listing is confidential and cannot be imported'
      )
    );
    expect(cardButton('Whitefield Apartment')).toBeTruthy();
    expect(cardLink('Whitefield Apartment')).toBeNull();
  });

  it('[PRP-053] costs a signed-out visitor one request and shows them nothing', async () => {
    probe.status = 401;
    renderShowcase();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    expect(chipButton()).toBeNull();
    expect(cardButton('Whitefield Apartment')).toBeNull();

    closeOpenListing();
    fireEvent.click(
      screen.getByRole('heading', { level: 3, name: 'Whitefield Apartment' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Whitefield Apartment' })
      ).toBeTruthy()
    );
    await settle();

    expect(probeCalls()).toHaveLength(1);
    expect(chipButton()).toBeNull();
  });

  it('[PRP-053] retries a failed probe instead of taking the visitor for signed out', async () => {
    probe.rejections = 1;
    renderShowcase({ open: false });
    await waitFor(
      () => expect(cardButton('Whitefield Apartment')).toBeTruthy(),
      { timeout: 3000 }
    );
    expect(probeCalls()).toHaveLength(2);
  });

  it('[PRP-053] shows nothing on the account’s own listings or to a member who cannot write', async () => {
    probe.viewer = { own: true, canImport: false, importedId: null };
    renderShowcase();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    expect(chipButton()).toBeNull();
    expect(cardButton('Whitefield Apartment')).toBeNull();
    cleanup();
    fetchMock.mockClear();

    probe.viewer = { own: false, canImport: false, importedId: null };
    renderShowcase();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    expect(chipButton()).toBeNull();
    expect(cardButton('Whitefield Apartment')).toBeNull();
    expect(chipLink()).toBeNull();
    expect(cardLink('Whitefield Apartment')).toBeNull();
  });

  it('[PRP-053] offers the control on the current Quick Picks card and moves it to the next card', async () => {
    renderShowcase({ open: false, dealFloor: true });
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    fireEvent.click(
      screen.getByRole('button', { name: /or play Quick Picks/ })
    );
    const deck = () =>
      within(screen.getByRole('region', { name: 'Quick Picks' }));
    const first = deck().getByRole('heading', { level: 3 }).textContent;
    const firstId = first === property.title ? 'prop-1' : 'prop-2';

    await waitFor(() =>
      expect(
        deck().getByRole('button', {
          name: /add this property to your inventory/i,
        })
      ).toBeTruthy()
    );
    fireEvent.click(
      deck().getByRole('button', {
        name: /add this property to your inventory/i,
      })
    );
    await waitFor(() =>
      expect(
        deck().getByRole('link', { name: 'In your inventory' })
      ).toBeTruthy()
    );
    expect(JSON.parse(String(importCalls()[0][1]?.body))).toEqual({
      property_id: firstId,
    });

    fireEvent.click(deck().getByRole('button', { name: `Skip ${first}` }));
    expect(deck().getByRole('heading', { level: 3 }).textContent).not.toBe(
      first
    );
    expect(
      deck().getByRole('button', {
        name: /add this property to your inventory/i,
      })
    ).toBeTruthy();
    expect(
      deck().queryByRole('link', { name: 'In your inventory' })
    ).toBeNull();
    expect(probeCalls()).toHaveLength(1);
  });

  it('[PRP-053] shows a signed-out visitor nothing on the Quick Picks card', async () => {
    probe.status = 401;
    renderShowcase({ open: false, dealFloor: true });
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    fireEvent.click(
      screen.getByRole('button', { name: /or play Quick Picks/ })
    );
    const deck = within(screen.getByRole('region', { name: 'Quick Picks' }));
    await settle();
    expect(
      deck.queryByRole('button', {
        name: /add this property to your inventory/i,
      })
    ).toBeNull();
    expect(probeCalls()).toHaveLength(1);
  });

  it('[PRP-053] lists the selected area\u2019s listings in the map panel with the control on each', async () => {
    const elsewhere = {
      ...property,
      id: 'prop-3',
      title: 'Hebbal Plot',
      sublocality: 'Hebbal',
      property_code: 'CR-003',
    } as unknown as Property;
    renderShowcase({ open: false, mapDiscovery: true, extra: [elsewhere] });
    const list = await screen.findByRole('list', {
      name: 'Listings on this map',
    });
    const rows = () =>
      within(screen.getByRole('list', { name: 'Listings on this map' }));
    expect(
      rows().getByRole('button', { name: 'Sarjapur JV Land' })
    ).toBeTruthy();
    expect(
      rows().getByRole('button', { name: 'Whitefield Apartment' })
    ).toBeTruthy();
    expect(rows().queryByRole('button', { name: 'Hebbal Plot' })).toBeNull();
    expect(list).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Area on map' }), {
      target: { value: 'Hebbal, Bangalore' },
    });
    await waitFor(() =>
      expect(rows().getByRole('button', { name: 'Hebbal Plot' })).toBeTruthy()
    );
    expect(
      rows().queryByRole('button', { name: 'Sarjapur JV Land' })
    ).toBeNull();
    expect(probeCalls()).toHaveLength(1);
  });

  it('[PRP-053] adds a listing from the map panel and updates its grid card too', async () => {
    probe.importBody = {
      data: { id: 'copy-2', title: 'Whitefield Apartment' },
    };
    renderShowcase({ open: false, mapDiscovery: true });
    const list = await screen.findByRole('list', {
      name: 'Listings on this map',
    });
    await waitFor(() =>
      expect(
        within(list).getByRole('button', {
          name: 'Add Whitefield Apartment to my inventory',
        })
      ).toBeTruthy()
    );

    fireEvent.click(
      within(list).getByRole('button', {
        name: 'Add Whitefield Apartment to my inventory',
      })
    );

    await waitFor(() =>
      expect(
        within(list).getByRole('link', {
          name: 'Whitefield Apartment is in your inventory',
        })
      ).toBeTruthy()
    );
    expect(
      screen.getAllByRole('link', {
        name: 'Whitefield Apartment is in your inventory',
      })
    ).toHaveLength(2);
    expect(JSON.parse(String(importCalls()[0][1]?.body))).toEqual({
      property_id: 'prop-2',
    });
  });

  it('[PRP-053] adds no listing list to the map panel for a signed-out visitor or on the account\u2019s own showcase', async () => {
    probe.status = 401;
    renderShowcase({ open: false, mapDiscovery: true });
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    expect(
      screen.getByRole('region', { name: 'Property locations' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('list', { name: 'Listings on this map' })
    ).toBeNull();
    cleanup();
    fetchMock.mockClear();

    probe.status = 200;
    probe.viewer = { own: true, canImport: false, importedId: null };
    renderShowcase({ open: false, mapDiscovery: true });
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await settle();
    expect(
      screen.queryByRole('list', { name: 'Listings on this map' })
    ).toBeNull();
  });
});
