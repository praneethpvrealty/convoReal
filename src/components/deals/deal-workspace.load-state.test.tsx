// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  deal: { data: null as unknown, error: null as { message: string } | null },
  index: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve(db.deal),
      };
      return chain;
    },
    rpc: () => Promise.resolve(db.index),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1', isViewer: false, isReadOnly: false }),
}));

import { DealWorkspace } from './deal-workspace';
import { TransactionWorkspaceIndex } from './transaction-workspace-index';

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  db.deal = { data: null, error: null };
  db.index = { data: [], error: null };
});

describe('closing record load states', () => {
  it('[UIX-037] offers a retry when the closing record fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => ({ data: {} }) }))
    );
    db.deal = { data: null, error: { message: 'network down' } };
    wrap(<DealWorkspace dealId="deal-1" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load this closing record.");
    expect(screen.queryByText('This closing record could not be found.')).toBe(
      null
    );
  });

  it('[UIX-037] says not found only when the record is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => ({ data: {} }) }))
    );
    wrap(<DealWorkspace dealId="deal-1" />);

    expect(
      await screen.findByText('This closing record could not be found.')
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('[UIX-037] shows a retry instead of "No records yet" when the index fails', async () => {
    db.index = { data: [], error: { message: 'timeout' } };
    wrap(<TransactionWorkspaceIndex />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load closing records.");
    expect(screen.queryByText('No records yet')).toBeNull();

    db.index = { data: [], error: null };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No records yet')).toBeTruthy();
  });
});
