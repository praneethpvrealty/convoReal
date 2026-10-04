// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AutomationAnalyticsContent from './analytics-content';

const analytics = vi.hoisted(() => ({
  loadAutomationAnalytics: vi.fn(),
  loadFlowAnalytics: vi.fn(),
  loadFlowNodeFunnel: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

vi.mock('@/lib/automations/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/automations/analytics')>()),
  ...analytics,
}));

const automationRow = {
  automation_id: 'a1',
  name: 'Keyword reply',
  is_active: true,
  trigger_type: 'keyword_match',
  runs: 10,
  succeeded: 6,
  partial: 4,
  failed: 0,
  last_run_at: null,
};

const flowRow = (id: string, name: string, runs: number) => ({
  flow_id: id,
  name,
  status: 'active',
  runs,
  active_runs: 0,
  completed: runs,
  handed_off: 0,
  timed_out: 0,
  paused_by_agent: 0,
  failed: 0,
  median_duration_seconds: null,
  avg_reprompts: null,
});

function renderAnalytics() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AutomationAnalyticsContent />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  analytics.loadAutomationAnalytics.mockResolvedValue([automationRow]);
  analytics.loadFlowAnalytics.mockResolvedValue([
    flowRow('f1', 'Welcome', 5),
    flowRow('f2', 'FAQ', 2),
  ]);
  analytics.loadFlowNodeFunnel.mockResolvedValue([
    { node_key: 'start', node_type: 'start', runs_entered: 5 },
    { node_key: 'bye', node_type: 'end', runs_entered: 4 },
    { node_key: 'menu', node_type: 'send_buttons', runs_entered: 3 },
  ]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        flow: { entry_node_id: 'start' },
        nodes: [
          { node_key: 'bye', node_type: 'end', config: {} },
          {
            node_key: 'menu',
            node_type: 'send_buttons',
            config: {
              text: 'Pick one',
              buttons: [{ reply_id: 'x', title: 'Bye', next_node_key: 'bye' }],
            },
          },
          {
            node_key: 'start',
            node_type: 'start',
            config: { next_node_key: 'menu' },
          },
        ],
      }),
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AutomationAnalyticsContent', () => {
  it('shows plain error copy with a Retry button', async () => {
    analytics.loadAutomationAnalytics.mockRejectedValueOnce(new Error('rpc'));
    renderAnalytics();
    await screen.findByText(/Couldn.t load analytics\./);
    expect(screen.queryByText(/migration 182/)).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Keyword reply');
  });

  it('labels the trigger, counts waiting runs apart and leaves them out of success', async () => {
    renderAnalytics();
    const row = (await screen.findByText('Keyword reply')).closest('tr')!;
    expect(within(row).getByText('Keyword Match')).toBeTruthy();
    expect(within(row).getByText('100%')).toBeTruthy();
    expect(screen.getByText('0 failed · 4 waiting')).toBeTruthy();
    expect(
      within(row)
        .getByRole('link', { name: 'Edit Keyword reply' })
        .getAttribute('href')
    ).toBe('/automations/a1/edit');
    expect(
      within(row)
        .getByRole('link', { name: 'Logs for Keyword reply' })
        .getAttribute('href')
    ).toBe('/automations/a1/logs');
  });

  it('marks the selected range and funnel', async () => {
    renderAnalytics();
    await screen.findByText('Keyword reply');
    expect(
      screen.getByRole('button', { name: '30d' }).getAttribute('aria-pressed')
    ).toBe('true');
    const funnelButtons = screen.getAllByRole('button', {
      name: 'View funnel',
    });
    expect(funnelButtons[0].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(funnelButtons[1]);
    expect(funnelButtons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('orders the node funnel by walking the flow from its entry and labels nodes', async () => {
    renderAnalytics();
    await screen.findByText('Pick one · Bye');
    const labels = screen
      .getByText(/Node Funnel/)
      .parentElement!.querySelectorAll('span[title]');
    expect([...labels].map((el) => el.getAttribute('title'))).toEqual([
      'Start',
      'Pick one · Bye',
      'End',
    ]);
  });
});
