// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }
// ============================================================
// "Add to my inventory" on the open listing — offered to a signed-in
// member of another brokerage, and to nobody else. The probe and the
// import go to the app origin with credentials, because a tenant
// showcase runs on its own subdomain and the session cookie does not.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const IMPORT_URL = 'https://www.convoreal.com/api/inventory/showcase-import';

type Viewer = { own: boolean; canImport: boolean; importedId: string | null };

const probe = vi.hoisted(() => ({
  status: 200,
  viewer: { own: false, canImport: true, importedId: null } as Viewer,
  reject: false,
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
    if (probe.reject) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: probe.status < 400,
      status: probe.status,
      json: () => Promise.resolve({ data: probe.viewer }),
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

function renderOpen(agentMode = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ShowcaseView
        properties={[property, second]}
        settings={settings}
        accountId="acct-1"
        initialPropertyId={property.id}
        initialAgentMode={agentMode}
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

const addButton = () =>
  screen.queryByRole('button', {
    name: /add this property to your inventory/i,
  });

beforeEach(() => {
  probe.status = 200;
  probe.viewer = { own: false, canImport: true, importedId: null };
  probe.reject = false;
  probe.importStatus = 201;
  probe.importBody = { data: { id: 'copy-1', title: 'Sarjapur JV Land' } };
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('showcase detail — add to my inventory', () => {
  it('[PRP-053] asks the app origin, with credentials, who the visitor is to the open listing', async () => {
    renderOpen();
    await waitFor(() => expect(addButton()).toBeTruthy());
    const [url, init] = probeCalls()[0];
    expect(String(url)).toBe(`${IMPORT_URL}?property_id=prop-1`);
    expect(init?.credentials).toBe('include');
  });

  it('[PRP-053] offers the control to a signed-in agent of another account, in the buyer view and the co-broker view alike', async () => {
    renderOpen();
    await waitFor(() => expect(addButton()).toBeTruthy());
    cleanup();
    fetchMock.mockClear();
    renderOpen(true);
    await waitFor(() => expect(addButton()).toBeTruthy());
  });

  it('[PRP-053] adds the listing with one tap and then links to the copy in the agent’s inventory', async () => {
    renderOpen();
    await waitFor(() => expect(addButton()).toBeTruthy());

    fireEvent.click(addButton()!);

    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: /in your inventory/i })
      ).toBeTruthy()
    );
    const [url, init] = importCalls()[0];
    expect(String(url)).toBe(IMPORT_URL);
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(String(init?.body))).toEqual({ property_id: 'prop-1' });
    expect(
      screen
        .getByRole('link', { name: /in your inventory/i })
        .getAttribute('href')
    ).toBe('https://www.convoreal.com/inventory?propertyId=copy-1');
    expect(addButton()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/added to your inventory/i)
    );
  });

  it('[PRP-053] shows the copy this account already holds instead of the add control', async () => {
    probe.viewer = { own: false, canImport: true, importedId: 'copy-old' };
    renderOpen();
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: /in your inventory/i })
      ).toBeTruthy()
    );
    expect(addButton()).toBeNull();
  });

  it('[PRP-053] surfaces the refusal when the import fails', async () => {
    probe.importStatus = 403;
    probe.importBody = {
      error: 'This listing is confidential and cannot be imported',
    };
    renderOpen();
    await waitFor(() => expect(addButton()).toBeTruthy());

    fireEvent.click(addButton()!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This listing is confidential and cannot be imported'
      )
    );
    expect(addButton()).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /in your inventory/i })
    ).toBeNull();
  });

  it('[PRP-053] shows nothing to a signed-out visitor and never asks again on this page', async () => {
    probe.status = 401;
    renderOpen();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(addButton()).toBeNull();

    const close = Array.from(document.querySelectorAll('button')).find((b) =>
      b.querySelector('svg.lucide-x')
    );
    if (!close) throw new Error('open listing has no close button');
    fireEvent.click(close);
    fireEvent.click(
      screen.getByRole('heading', { level: 3, name: 'Whitefield Apartment' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Whitefield Apartment' })
      ).toBeTruthy()
    );

    expect(probeCalls()).toHaveLength(1);
    expect(addButton()).toBeNull();
  });

  it('[PRP-053] shows nothing when the probe fails, without taking the visitor for signed out', async () => {
    probe.reject = true;
    renderOpen();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(addButton()).toBeNull();
    expect(
      screen.queryByRole('link', { name: /in your inventory/i })
    ).toBeNull();

    const close = Array.from(document.querySelectorAll('button')).find((b) =>
      b.querySelector('svg.lucide-x')
    );
    if (!close) throw new Error('open listing has no close button');
    fireEvent.click(close);
    probe.reject = false;
    fireEvent.click(
      screen.getByRole('heading', { level: 3, name: 'Whitefield Apartment' })
    );
    await waitFor(() => expect(addButton()).toBeTruthy());
    expect(probeCalls()).toHaveLength(2);
  });

  it('[PRP-053] shows nothing on the account’s own listing or to a member who cannot write', async () => {
    probe.viewer = { own: true, canImport: false, importedId: null };
    renderOpen();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    expect(addButton()).toBeNull();
    cleanup();
    fetchMock.mockClear();

    probe.viewer = { own: false, canImport: false, importedId: null };
    renderOpen();
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    expect(addButton()).toBeNull();
    expect(
      screen.queryByRole('link', { name: /in your inventory/i })
    ).toBeNull();
  });
});
