// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Property } from '@/types';
import { PropertyShareDialog } from './property-share-dialog';

function chain(result: unknown): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

const client = {
  from: () => chain({ data: [], error: null }),
  rpc: () => chain({ data: [], error: null }),
};

vi.mock('@/lib/supabase/client', () => ({ createClient: () => client }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    accountId: 'a1',
    profile: { full_name: 'Praneeth', phone: '919900000000' },
  }),
}));
vi.mock('@/hooks/useCan', () => ({ useCan: () => true }));
vi.mock('@/lib/contacts/inquired-intent', () => ({
  attachInquiredListingTypes: async (
    _supabase: unknown,
    _account: string,
    rows: unknown[]
  ) => rows,
}));

const grant = {
  id: 'g1',
  token: 'tok1',
  reveal_location: true,
  reveal_documents: false,
  reveal_private_images: false,
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  view_count: 2,
  last_viewed_at: null,
  created_at: new Date().toISOString(),
  contact: { id: 'c1', name: 'Yusuf Sameer', phone: '919800000001' },
};

const fetchMock = vi.fn();

function deletes() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
}

const property = {
  id: 'p1',
  title: '3200 sqft commercial plot is for sale on ITPL road, Whitefield.',
  type: 'Commercial Land',
  price: 110600000,
  images: [],
  documents: [],
  private_images: [],
  is_published: true,
} as unknown as Property;

beforeEach(() => {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/share-grants') && !init?.method) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [grant] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderDialog(onPromote?: (p: Property) => void) {
  return render(
    <PropertyShareDialog
      open
      onOpenChange={() => {}}
      property={property}
      onPromote={onPromote}
    />
  );
}

describe('[PRP-045] PropertyShareDialog', () => {
  it('names the listing in the header without its trailing full stop', () => {
    renderDialog();
    expect(
      screen.getByText(
        '3200 sqft commercial plot is for sale on ITPL road, Whitefield'
      )
    ).toBeTruthy();
  });

  it('asks before revoking an unmasked link', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /^Revoke$/ }));
    expect(deletes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Revoke now/ }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(String(deletes()[0][0])).toContain('grant_id=g1');
  });

  it('keeps the link live when the agent backs out of a revoke', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /^Revoke$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('button', { name: /Revoke now/ })).toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it('points to the listing instead of offering reveals it cannot make', () => {
    renderDialog();
    expect(
      screen.getByText(/No documents or guarded photos on this listing yet/)
    ).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'Open the listing to add them',
    });
    expect(link.getAttribute('href')).toBe('/inventory?propertyId=p1');
    expect(screen.queryByRole('button', { name: /Guarded photos/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Documents/ })).toBeNull();
  });

  it('offers the paid ad under Send from Engine, not among the share channels', () => {
    const onPromote = vi.fn();
    renderDialog(onPromote);
    expect(screen.queryByRole('button', { name: /Set up the ad/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Promote as WhatsApp Ad/ })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send from Engine/ }));
    fireEvent.click(screen.getByRole('button', { name: /Set up the ad/ }));
    expect(onPromote).toHaveBeenCalledWith(property);
  });
});
