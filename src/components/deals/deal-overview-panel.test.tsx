// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// [TXW-030] The deal workspace opens on a status page: what is next on
// the closing checklist, the open tasks, the latest timeline entry, the
// people and the money, each a tick or a tab away. The forms live on
// the Money tab.
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DealOverviewPanel } from '@/components/deals/deal-overview-panel';

const DEAL_ID = 'deal-1';

const MILESTONES = [
  {
    id: 'm1',
    title: 'Token received',
    position: 0,
    status: 'completed',
    target_date: null,
    completed_at: '2026-09-01T10:00:00Z',
    visibility: 'internal',
    template_key: 'token_received',
  },
  {
    id: 'm2',
    title: 'Sale agreement signed',
    position: 1,
    status: 'pending',
    target_date: '2026-10-10',
    completed_at: null,
    visibility: 'internal',
    template_key: 'agreement_signed',
  },
  {
    id: 'm3',
    title: 'Registration',
    position: 2,
    status: 'pending',
    target_date: null,
    completed_at: null,
    visibility: 'internal',
    template_key: 'registration',
  },
];

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function mockApi() {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') return json({ data: {} });
    if (url.endsWith('/milestones')) return json({ data: MILESTONES });
    if (url.startsWith('/api/todos')) return json([]);
    if (url.endsWith('/events')) return json({ data: [] });
    if (url.endsWith('/stakeholders')) return json({ data: [] });
    if (url.endsWith('/financials'))
      return json({
        data: {
          brokerage_received_amount: 500000,
          token_source: 'manual',
          token: {
            source: 'manual',
            amount: 1000000,
            received_at: '2026-09-02',
            reference: null,
            status: null,
          },
        },
      });
    if (url.endsWith('/tranches'))
      return json({
        data: {
          tranches: [],
          summary: {
            count: 2,
            scheduled: 2000000,
            received: 1000000,
            outstanding: 1000000,
          },
        },
      });
    return json({ error: 'not found' }, false);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DealOverviewPanel
        dealId={DEAL_ID}
        deal={{
          value: 81600000,
          currency: 'INR',
          brokerage_type: 'percentage',
          brokerage_value: 2,
          brokerage_amount: null,
          co_broker_payout_total: null,
        }}
        canEdit
        onOpenTab={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe('DealOverviewPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('[TXW-030] shows the next pending milestone and the checklist progress', async () => {
    mockApi();
    renderPanel();
    expect(await screen.findByText('Sale agreement signed')).toBeTruthy();
    expect(screen.getByText('1 / 3 done')).toBeTruthy();
    expect(screen.queryByText('Registration')).toBeNull();
  });

  it('[TXW-030] prints the money in one compact rupee format', async () => {
    mockApi();
    renderPanel();
    expect(await screen.findByText('₹8.16 Cr')).toBeTruthy();
    expect(screen.getByText('Brokerage')).toBeTruthy();
    expect(screen.getByText('₹16.32 L')).toBeTruthy();
    expect(screen.getByText('2% of the deal')).toBeTruthy();
    expect(await screen.findByText('₹5 L')).toBeTruthy();
    expect(screen.getByText('₹11.32 L')).toBeTruthy();
    expect(screen.getByText('₹10 L')).toBeTruthy();
    expect(screen.getByText('₹10 L received')).toBeTruthy();
    expect(screen.getByText('₹10 L outstanding')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Rs.');
  });

  it('[TXW-030] ticking the next milestone completes it through the milestone route', async () => {
    const fetchMock = mockApi();
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Mark Sale agreement signed completed',
      })
    );
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(patch![0]).toBe(`/api/deals/${DEAL_ID}/milestones/m2`);
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        status: 'completed',
        source: 'web',
      });
    });
  });
});
