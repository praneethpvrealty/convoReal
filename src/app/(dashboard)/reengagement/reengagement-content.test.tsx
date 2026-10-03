// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/use-auth', () => ({
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

function setup(leads: ReengagementLead[], sum: ReengagementSummary) {
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
    total: leads.length,
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

function rowOrder() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('a')?.textContent);
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
          matchCount: 2,
          repliedAt: '2026-08-10T00:00:00Z',
        }),
        lead({
          contactId: 'b',
          contactName: 'Bala',
          matchCount: 9,
          repliedAt: null,
        }),
      ],
      summary({ leads: 2, matched: 2 })
    );
    await screen.findByText('Asha');
    expect(screen.getByText('Last reply')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Last reply/ })).toBeNull();
    expect(rowOrder()).toEqual(['Asha', 'Bala']);
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
