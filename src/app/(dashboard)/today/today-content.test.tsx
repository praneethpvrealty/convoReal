// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import TodayPage from './today-content';

const loaders = vi.hoisted(() => ({
  expiring: vi.fn(),
  hot: vi.fn(),
  agenda: vi.fn(),
  insights: vi.fn(),
  deadlines: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

vi.mock('@/lib/today/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/today/queries')>()),
  loadExpiringSessions: loaders.expiring,
  loadHotGoingQuiet: loaders.hot,
  loadTodaysAgenda: loaders.agenda,
  loadRangeInsights: loaders.insights,
}));

vi.mock('@/lib/deals/deadlines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deals/deadlines')>()),
  loadDealDeadlines: loaders.deadlines,
}));

const INSIGHTS = {
  newInquiries: 3,
  newContacts: 2,
  messagesReceived: 10,
  messagesSent: 8,
  respondedConversations: 2,
  inboundConversations: 3,
  showcaseOpens: 1,
};

beforeEach(() => {
  loaders.expiring.mockResolvedValue([]);
  loaders.hot.mockResolvedValue([]);
  loaders.agenda.mockResolvedValue({ appointments: [], todos: [] });
  loaders.insights.mockResolvedValue(INSIGHTS);
  loaders.deadlines.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[UIX-053] Today shows a retry when a section fails to load', () => {
  it('replaces the empty state with a retryable error', async () => {
    loaders.hot.mockRejectedValueOnce(new Error('network'));
    render(<TodayPage />);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toContain('hot leads');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(loaders.hot).toHaveBeenCalledTimes(2);
  });

  it('shows a retry for activity insights instead of zeros', async () => {
    loaders.insights.mockRejectedValueOnce(new Error('network'));
    render(<TodayPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('activity insights');

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.getByText('10')).toBeTruthy());
  });
});

describe('[UIX-052] Today custom range', () => {
  it('says so when the end date is before the start date', async () => {
    render(<TodayPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const [from, to] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="date"]')
    );
    fireEvent.change(from, { target: { value: '2026-11-05' } });
    fireEvent.change(to, { target: { value: '2026-11-01' } });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The end date must be on or after the start date'
    );
  });
});
