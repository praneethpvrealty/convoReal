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

function renderDialog(
  onPromote?: (p: Property) => void,
  overrides: Partial<Property> = {},
  onOpenChange: (open: boolean) => void = () => {}
) {
  return render(
    <PropertyShareDialog
      open
      onOpenChange={onOpenChange}
      property={{ ...property, ...overrides }}
      onPromote={onPromote}
    />
  );
}

const NOTE =
  'Please note: this property is currently under contract with another buyer, but the deal is not closed yet. Our team will check the latest status with the owner and update you here.';

function draft(): string {
  const area = document.querySelector('textarea');
  expect(area).not.toBeNull();
  return (area as HTMLTextAreaElement).value;
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

describe('[PRP-048] sharing a listing that has left the market', () => {
  it('composes a live listing straight away', () => {
    renderDialog();
    expect(screen.queryByTestId('share-unavailable-gate')).toBeNull();
    expect(screen.getByTestId('share-send-bar')).toBeTruthy();
  });

  it('asks before an under-contract listing is shared and keeps every send path behind the question', () => {
    const onOpenChange = vi.fn();
    renderDialog(undefined, { status: 'Under Contract' }, onOpenChange);
    expect(screen.getByTestId('share-unavailable-gate')).toBeTruthy();
    expect(
      screen.getByText('This listing is under contract — share it anyway?')
    ).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.queryByTestId('share-send-bar')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Send from Engine/ })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Don’t share' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shares with the availability note when asked to, and can leave it out again', () => {
    renderDialog(undefined, { status: 'Under Contract' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Share with the note' })
    );
    expect(screen.queryByTestId('share-unavailable-gate')).toBeNull();
    expect(screen.getByTestId('share-send-bar')).toBeTruthy();
    expect(draft().endsWith(`\n\n${NOTE}`)).toBe(true);
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('Under contract · availability note included');
    fireEvent.click(screen.getByRole('button', { name: 'Leave the note out' }));
    expect(draft()).not.toContain('Please note:');
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('availability note left out');
  });

  it('asks again before the listing is broadcast from the Engine and reports how the note travelled', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/share-grants') && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [grant] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    renderDialog(undefined, { status: 'Under Contract' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Share with the note' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Send from Engine/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: /Select Contacts & Share on WhatsApp/,
      })
    );
    const gate = screen.getByTestId('broadcast-unavailable-gate');
    expect(gate.textContent).toContain(
      'Broadcast a listing that is under contract?'
    );
    expect(gate.textContent).toContain(
      'follows as a second message for every buyer who has written in the last 24 hours'
    );
    expect(gate.textContent).toContain(NOTE);
    expect(screen.queryByPlaceholderText(/Search contacts/)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Broadcast without the note' })
    );
    expect(screen.queryByTestId('broadcast-unavailable-gate')).toBeNull();
    expect(screen.getByPlaceholderText(/Search contacts/)).toBeTruthy();
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('availability note left out');
    fireEvent.click(screen.getByRole('button', { name: 'Include the note' }));
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('follows the template inside the 24-hour window');
  });

  it('backs out of the broadcast without sharing when asked not to', () => {
    renderDialog(undefined, { status: 'Sold' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Share without the note' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Send from Engine/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /Select Contacts & Send Greeting/ })
    );
    expect(
      screen.getByTestId('broadcast-unavailable-gate').textContent
    ).toContain('The greeting itself cannot carry the note');
    fireEvent.click(screen.getByRole('button', { name: 'Don’t broadcast' }));
    expect(screen.queryByTestId('broadcast-unavailable-gate')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Send from Engine/ })
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search contacts/)).toBeNull();
  });

  it('shares without the note when asked to, and says templates cannot carry it', () => {
    renderDialog(undefined, { status: 'Off Market' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Share without the note' })
    );
    expect(draft()).not.toContain('Please note:');
    fireEvent.click(screen.getByRole('button', { name: 'Include the note' }));
    expect(draft()).toContain(
      'Please note: this property is off the market for now.'
    );
    fireEvent.click(screen.getByRole('button', { name: /Send from Engine/ }));
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('follows the template inside the 24-hour window');
    fireEvent.click(screen.getByRole('button', { name: 'Leave the note out' }));
    expect(
      screen.getByTestId('share-unavailable-choice').textContent
    ).toContain('availability note left out');
  });
});
