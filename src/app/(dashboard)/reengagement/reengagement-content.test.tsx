// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ReengagementLead,
  ReengagementSummary,
} from '@/lib/reengagement/queries';
import ReengagementContent from './reengagement-content';

const queries = vi.hoisted(() => ({
  loadReengagementBatches: vi.fn(),
  loadReengagementSummary: vi.fn(),
  loadReengagementLeads: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));

vi.mock('@/lib/reengagement/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reengagement/queries')>()),
  ...queries,
}));

vi.mock('@/components/reengagement/shortlist-dialog', () => ({
  ShortlistDialog: () => null,
}));

function lead(over: Partial<ReengagementLead>): ReengagementLead {
  return {
    contactId: 'c1',
    contactName: 'Ajay',
    contactPhone: '+919876543210',
    broadcastId: 'b1',
    broadcastName: 'Batch',
    batchSentAt: '2026-08-07T05:00:00Z',
    status: 'sent',
    repliedAt: null,
    requirementUpdatedAt: null,
    budgetMin: null,
    budgetMax: null,
    areas: [],
    matchEventId: 'e1',
    matchCount: 1,
    matchEventStatus: null,
    ...over,
  };
}

function summary(over: Partial<ReengagementSummary> = {}) {
  return {
    batches: 6,
    leads: 3,
    sent: 3,
    delivered: 3,
    read: 3,
    replied: 3,
    requirementUpdated: 3,
    matched: 3,
    failed: 0,
    ...over,
  };
}

function setup(
  leads: ReengagementLead[],
  sum: ReengagementSummary,
  total = leads.length
) {
  queries.loadReengagementBatches.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => ({
      broadcastId: `b${i}`,
      name: `Batch ${i}`,
      sentAt: '2026-08-07T05:00:00Z',
      status: 'sent',
      totalRecipients: 10,
    }))
  );
  queries.loadReengagementSummary.mockResolvedValue(sum);
  queries.loadReengagementLeads.mockResolvedValue({
    leads,
    total,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReengagementContent />
    </QueryClientProvider>
  );
}

function lastLeadsRequest() {
  return queries.loadReengagementLeads.mock.calls.at(-1)?.[2];
}

function sortOf(name: RegExp) {
  return screen
    .getByRole('button', { name })
    .closest('th')
    ?.getAttribute('aria-sort');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReengagementContent', () => {
  it('sizes the batch select to its content, right-aligned', async () => {
    setup([lead({})], summary());
    const select = await screen.findByRole('combobox');
    expect(select.className).toContain('w-auto');
    expect(select.className).toContain('max-w-[18rem]');
    expect(select.className).toContain('ml-auto');
  });

  it('shows the masked phone under a name so duplicates can be told apart', async () => {
    setup(
      [
        lead({ contactId: 'a', contactPhone: '+919876543210' }),
        lead({ contactId: 'b', contactPhone: '+919123450001' }),
      ],
      summary({ leads: 2, matched: 2 })
    );
    expect(await screen.findByText(/•••• 3210/)).toBeTruthy();
    expect(screen.getByText(/•••• 0001/)).toBeTruthy();
    expect(screen.queryByText(/9876543210/)).toBeNull();
  });

  it('shows the last reply for each lead', async () => {
    setup(
      [
        lead({
          contactId: 'a',
          contactName: 'Asha',
          repliedAt: '2026-08-10T00:00:00Z',
        }),
        lead({ contactId: 'b', contactName: 'Bala', repliedAt: null }),
      ],
      summary({ leads: 2, matched: 2 })
    );
    await screen.findByText('Asha');
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td')[4]?.textContent);
    expect(cells[0]).not.toBe('—');
    expect(cells[1]).toBe('—');
  });

  it('asks the server for the standing batch order first', async () => {
    setup([lead({})], summary());
    await screen.findByText('Ajay');
    expect(lastLeadsRequest()).toMatchObject({ sort: 'batch', page: 0 });
    expect(sortOf(/Matches/)).toBe('none');
    expect(sortOf(/Last reply/)).toBe('none');
  });

  it('sorts by matches on the server: descending, ascending, then back', async () => {
    setup([lead({})], summary());
    await screen.findByText('Ajay');

    fireEvent.click(screen.getByRole('button', { name: /Matches/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'matches_desc' })
    );
    expect(sortOf(/Matches/)).toBe('descending');
    expect(sortOf(/Last reply/)).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: /Matches/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'matches_asc' })
    );
    expect(sortOf(/Matches/)).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: /Matches/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'batch' })
    );
    expect(sortOf(/Matches/)).toBe('none');
  });

  it('sorts by last reply on the server and clears the other column', async () => {
    setup([lead({})], summary());
    await screen.findByText('Ajay');

    fireEvent.click(screen.getByRole('button', { name: /Matches/ }));
    fireEvent.click(screen.getByRole('button', { name: /Last reply/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'replied_desc' })
    );
    expect(sortOf(/Last reply/)).toBe('descending');
    expect(sortOf(/Matches/)).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: /Last reply/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'replied_asc' })
    );
    expect(sortOf(/Last reply/)).toBe('ascending');
  });

  it('goes back to the first page when the sort changes', async () => {
    setup([lead({})], summary({ leads: 250, matched: 10 }), 250);
    await screen.findByText('Ajay');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'batch', page: 1 })
    );
    await screen.findByText('Page 2 of 3');

    fireEvent.click(screen.getByRole('button', { name: /Last reply/ }));
    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({
        sort: 'replied_desc',
        page: 0,
      })
    );
    await screen.findByText('Page 1 of 3');
  });

  it('keeps the header in place while a new order loads', async () => {
    setup([lead({})], summary());
    await screen.findByText('Ajay');
    const header = screen.getByRole('button', { name: /Matches/ });

    queries.loadReengagementLeads.mockReturnValue(new Promise(() => {}));
    fireEvent.click(header);

    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ sort: 'matches_desc' })
    );
    expect(screen.getByRole('button', { name: /Matches/ })).toBe(header);
    expect(screen.getByText('Ajay')).toBeTruthy();
  });

  it('drops the old rows when the filter changes, so no action targets another result set', async () => {
    setup([lead({})], summary({ leads: 250, matched: 10 }), 250);
    await screen.findByText('Ajay');

    queries.loadReengagementLeads.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /Show matched only/ }));

    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ onlyMatched: true, page: 0 })
    );
    expect(screen.queryByText('Ajay')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Shortlist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('drops the old rows when another batch is picked', async () => {
    setup([lead({})], summary());
    await screen.findByText('Ajay');

    queries.loadReengagementLeads.mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b3' } });

    await waitFor(() =>
      expect(lastLeadsRequest()).toMatchObject({ broadcastId: 'b3' })
    );
    await screen.findByText('Delivered');
    expect(screen.queryByText('Ajay')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Shortlist' })).toBeNull();
  });

  it('hides the matched-only filter when every lead is matched', async () => {
    setup([lead({})], summary({ leads: 3, matched: 3 }));
    await screen.findByText('Ajay');
    expect(screen.queryByRole('button', { name: /matched only/ })).toBeNull();
  });

  it('keeps the matched-only filter when some leads are unmatched', async () => {
    setup([lead({})], summary({ leads: 3, matched: 1 }));
    await screen.findByText('Ajay');
    expect(
      screen.getByRole('button', { name: /Show matched only/ })
    ).toBeTruthy();
  });
});
