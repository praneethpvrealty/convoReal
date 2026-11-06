// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const db = vi.hoisted(() => ({
  ors: [] as string[],
  deletes: 0,
  rows: {
    properties: [] as unknown[],
    contacts: [] as unknown[],
    contact_notes: [] as unknown[],
  } as Record<string, unknown[]>,
  client: null as unknown,
}));

function makeClient() {
  return {
    from: (table: string) => {
      let orFilter: string | null = null;
      let limit = Infinity;
      let deleting = false;
      const run = () => {
        if (deleting) {
          db.deletes += 1;
          return { data: [{ id: 'n1' }], error: null };
        }
        if (orFilter) db.ors.push(`${table}:${orFilter}`);
        const rows = db.rows[table] ?? [];
        return { data: rows.slice(0, limit), error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        delete: () => {
          deleting = true;
          return chain;
        },
        or: (value: string) => {
          orFilter = value;
          return chain;
        },
        limit: (n: number) => {
          limit = n;
          return chain;
        },
        then: (resolve: (value: ReturnType<typeof run>) => unknown) =>
          Promise.resolve(run()).then(resolve),
      };
      return chain;
    },
  };
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    if (!db.client) db.client = makeClient();
    return db.client;
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'acct-1' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { AddItemsDialog } from './add-items-dialog';
import { ContactNotesDialog } from './contact-notes-dialog';
import { PICKER_LIMIT } from '@/lib/journey/picker';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db.ors = [];
  db.deletes = 0;
  db.rows = { properties: [], contacts: [], contact_notes: [] };
});

describe('AddItemsDialog', () => {
  it('[UIX-039] says the list is truncated and searches on the server', async () => {
    db.rows.properties = Array.from({ length: PICKER_LIMIT + 5 }, (_, i) => ({
      id: `p${i}`,
      title: `Listing ${i}`,
    }));
    render(
      <AddItemsDialog
        open
        onOpenChange={vi.fn()}
        mode="buyer"
        accountId="acct-1"
        existingIds={new Set()}
        currency="INR"
        onAdd={vi.fn()}
      />
    );

    expect((await screen.findByRole('status')).textContent).toBe(
      `Showing the first ${PICKER_LIMIT} properties — type to search for the rest.`
    );
    expect(screen.getAllByText(/^Listing \d+$/)).toHaveLength(PICKER_LIMIT);

    vi.useFakeTimers();
    fireEvent.change(
      screen.getByPlaceholderText('Search by title, code or locality…'),
      { target: { value: 'Whitefield' } }
    );
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    vi.useRealTimers();

    await waitFor(() => expect(db.ors).toHaveLength(1));
    expect(db.ors[0]).toContain('properties:title.ilike."%Whitefield%"');
    expect(db.ors[0]).toContain('property_code.ilike."%Whitefield%"');
  });
});

describe('ContactNotesDialog', () => {
  it('[UIX-042] asks before deleting a note', async () => {
    db.rows.contact_notes = [
      {
        id: 'n1',
        note_text: 'Prefers east facing',
        created_at: '2026-10-01T10:00:00Z',
      },
    ];
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    render(
      <ContactNotesDialog
        open
        onOpenChange={vi.fn()}
        contactId="c1"
        contactName="Ravi"
        canEdit
      />
    );

    await screen.findByText('Prefers east facing');
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(confirmMock).toHaveBeenCalledWith(
      'Delete this note? This cannot be undone.'
    );
    expect(db.deletes).toBe(0);

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(db.deletes).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText('Prefers east facing')).toBeNull()
    );
  });
});
