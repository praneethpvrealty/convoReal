// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { CreditMeter } from './credit-meter';
import { SidebarCreditWidget } from './sidebar-credit-widget';
import { TopupModalProvider } from './topup-modal-context';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: () => undefined,
    }),
  };
});

const WALLET = {
  total: 60,
  monthly: 60,
  bonus: 0,
  referral: 0,
  purchased: 0,
  promo: 0,
  pendingReferral: 0,
  monthlyResetAt: null,
  status: 'low',
};

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TopupModalProvider>{children}</TopupModalProvider>
    </QueryClientProvider>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('[UIX-051] credit balance never reads 0 while loading or failed', () => {
  it('shows a skeleton, not a zero balance, while the wallet loads', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(wrap(<SidebarCreditWidget />));
    expect(screen.getByLabelText('Loading credits')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows — and Retry when the wallet fails, and recovers on retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    render(wrap(<SidebarCreditWidget />));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('—');
    expect(alert.textContent).toContain('Couldn');
    expect(alert.textContent).not.toMatch(/\b0\b/);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(WALLET), { status: 200 })
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.getByText('60')).toBeTruthy());
  });

  it('header chip offers a retry instead of disappearing on failure', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    render(wrap(<CreditMeter />));
    expect(
      await screen.findByRole('button', {
        name: "Couldn't load credits. Retry",
      })
    ).toBeTruthy();
  });

  it('fills the meter in proportion to the balance, never past 100%', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(WALLET), { status: 200 })
    );
    const { container } = render(wrap(<SidebarCreditWidget />));
    await screen.findByText('60');
    const bar = container.querySelector<HTMLElement>('[style*="width"]');
    expect(bar?.style.width).toBe('60%');
  });
});
