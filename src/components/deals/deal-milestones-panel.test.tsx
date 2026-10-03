// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// [TXW-031] The closing checklist reads as a checklist: a tick and a
// title per row, one line of what matters, and the status, visibility
// and due-date controls tucked behind one options button.
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DealMilestonesPanel } from '@/components/deals/deal-milestones-panel';

const MILESTONES = [
  {
    id: 'm1',
    title: 'Sale agreement signed',
    position: 0,
    status: 'pending',
    target_date: '2026-10-10',
    completed_at: null,
    visibility: 'internal',
    template_key: null,
  },
];

function renderPanel() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: MILESTONES }),
      })
    )
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DealMilestonesPanel dealId="deal-1" canEdit />
    </QueryClientProvider>
  );
}

describe('DealMilestonesPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('[TXW-031] reads the due date on one meta line', async () => {
    renderPanel();
    expect(await screen.findByText('Due 10 Oct 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeTruthy();
  });

  it('[TXW-031] keeps the status, visibility and due controls behind the options button', async () => {
    renderPanel();
    const options = await screen.findByRole('button', {
      name: 'Options for Sale agreement signed',
    });
    expect(screen.queryByLabelText('Status')).toBeNull();
    expect(screen.queryByLabelText('Who can see it')).toBeNull();
    expect(screen.queryByLabelText('Due')).toBeNull();
    expect(options.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(options);

    expect(options.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Who can see it')).toBeTruthy();
    expect(screen.getByLabelText('Due')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
