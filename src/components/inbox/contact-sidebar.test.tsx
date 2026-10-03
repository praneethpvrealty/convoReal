// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The inbox's right-hand contact panel.
//
// Switching conversations swaps the header at once but the deals,
// notes and tags arrive a query later. Until they do, the panel used
// to keep showing the previous contact's rows under the new contact's
// name — an agent on a call read another buyer's deals as this one's.
// The panel now renders placeholders for those sections until the new
// contact's own rows land, and a slow response for the contact that
// was just left can never overwrite them.
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import type { Contact } from '@/types';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'acct-1' }),
}));

type Rows = {
  deals: Array<Record<string, unknown>>;
  contact_notes: Array<Record<string, unknown>>;
  contact_tags: Array<Record<string, unknown>>;
};

const responses = vi.hoisted(() => ({
  pending: new Map<
    string,
    { promise: Promise<Rows>; resolve: (r: Rows) => void }
  >(),
}));

function deferredFor(contactId: string) {
  let entry = responses.pending.get(contactId);
  if (!entry) {
    let resolve!: (r: Rows) => void;
    const promise = new Promise<Rows>((res) => {
      resolve = res;
    });
    entry = { promise, resolve };
    responses.pending.set(contactId, entry);
  }
  return entry;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      let contactId = '';
      const query = {
        select: () => query,
        order: () => query,
        eq: (_column: string, value: string) => {
          contactId = value;
          return query;
        },
        single: () =>
          Promise.resolve({ data: { currency: 'INR' }, error: null }),
        then: (
          onFulfilled: (value: { data: unknown; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          deferredFor(contactId)
            .promise.then((rows) => ({
              data: rows[table as keyof Rows],
              error: null,
            }))
            .then(onFulfilled, onRejected),
      };
      return query;
    },
  }),
}));

import { ContactSidebar } from '@/components/inbox/contact-sidebar';

function contact(id: string, name: string): Contact {
  return {
    id,
    name,
    phone: `+9198000000${id.length}`,
    account_id: 'acct-1',
  } as unknown as Contact;
}

function rows(dealTitle: string, note: string): Rows {
  return {
    deals: [
      {
        id: `deal-${dealTitle}`,
        title: dealTitle,
        value: 100,
        currency: 'INR',
        stage: null,
      },
    ],
    contact_notes: [
      {
        id: `note-${note}`,
        note_text: note,
        is_completed: false,
        created_at: '2026-10-01T10:00:00.000Z',
      },
    ],
    contact_tags: [],
  };
}

const varun = contact('c-varun', 'Varun Somani');
const bhagavan = contact('c-bhagavan', 'Dr K Bhagavan');

afterEach(() => {
  cleanup();
  responses.pending.clear();
});

describe('ContactSidebar [INB-023]', () => {
  it('shows placeholders, not the previous contact’s deals and notes, until the new contact loads', async () => {
    const view = render(<ContactSidebar contact={varun} />);
    deferredFor(varun.id).resolve(rows('Avalahalli land', 'Wants 2 acres'));
    expect(await screen.findByText('Avalahalli land')).toBeTruthy();
    expect(screen.getByText('Wants 2 acres')).toBeTruthy();

    view.rerender(<ContactSidebar contact={bhagavan} />);

    expect(screen.getByText('Dr K Bhagavan')).toBeTruthy();
    expect(screen.queryByText('Avalahalli land')).toBeNull();
    expect(screen.queryByText('Wants 2 acres')).toBeNull();
    expect(screen.queryByText('No deals')).toBeNull();
    expect(screen.queryByText('No notes yet')).toBeNull();

    deferredFor(bhagavan.id).resolve(
      rows('Banashankari office', 'Pre-rented preferred')
    );
    expect(await screen.findByText('Banashankari office')).toBeTruthy();
    expect(screen.getByText('Pre-rented preferred')).toBeTruthy();
    expect(screen.queryByText('Avalahalli land')).toBeNull();
  });

  it('drops a slow response for the contact that was left', async () => {
    const view = render(<ContactSidebar contact={varun} />);
    view.rerender(<ContactSidebar contact={bhagavan} />);

    deferredFor(bhagavan.id).resolve(rows('Banashankari office', 'Site visit'));
    expect(await screen.findByText('Banashankari office')).toBeTruthy();

    deferredFor(varun.id).resolve(rows('Avalahalli land', 'Wants 2 acres'));
    await waitFor(() => {
      expect(screen.getByText('Banashankari office')).toBeTruthy();
    });
    expect(screen.queryByText('Avalahalli land')).toBeNull();
    expect(screen.queryByText('Wants 2 acres')).toBeNull();
  });
});
