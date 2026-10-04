// @vitest-environment happy-dom

import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AutomationLogsPage from './page';

const db = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = db.results[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      };
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => result;
      return builder;
    },
  }),
}));

vi.mock('@/components/contacts/name-tag-badge', () => ({
  NameTagBadge: () => null,
}));

function log(id: string, status: string, over: Record<string, unknown> = {}) {
  return {
    id,
    automation_id: 'a1',
    user_id: 'u1',
    contact_id: 'c1',
    trigger_event: 'keyword_match',
    steps_executed: [],
    status,
    created_at: '2026-10-01T09:05:00Z',
    contact: { id: 'c1', name: 'Asha', phone: '+91' },
    ...over,
  };
}

async function renderLogs() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const params = Promise.resolve({ id: 'a1' });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <AutomationLogsPage params={params} />
        </Suspense>
      </QueryClientProvider>
    );
  });
}

afterEach(() => {
  cleanup();
  db.results = {};
});

describe('AutomationLogsPage', () => {
  it('shows a not-found state instead of loading forever when the automation is missing', async () => {
    db.results = {
      automations: { data: null, error: null },
      automation_logs: { data: [], error: null },
    };
    await renderLogs();
    await screen.findByText('Automation not found');
    expect(
      screen
        .getByRole('link', { name: 'Back to automations' })
        .getAttribute('href')
    ).toBe('/automations');
  });

  it('labels triggers and waiting runs in words and links the contact and chat', async () => {
    db.results = {
      automations: {
        data: {
          id: 'a1',
          name: 'Keyword reply',
          trigger_type: 'keyword_match',
        },
        error: null,
      },
      automation_logs: {
        data: [log('l1', 'partial'), log('l2', 'failed', { contact_id: null })],
        error: null,
      },
      conversations: {
        data: [{ id: 'conv1', contact_id: 'c1' }],
        error: null,
      },
    };
    await renderLogs();
    await screen.findByText('Keyword reply');
    expect(screen.getAllByText('Waiting at a Wait step').length).toBe(1);
    expect(screen.getAllByText(/Keyword Match · 0 steps/).length).toBe(2);
    expect(
      screen.getAllByRole('link', { name: 'Asha' })[0].getAttribute('href')
    ).toBe('/contacts?contactId=c1');
    expect(
      screen.getByRole('link', { name: /Open chat/ }).getAttribute('href')
    ).toBe('/inbox?c=conv1');
    expect(
      screen.getByRole('link', { name: /Edit/ }).getAttribute('href')
    ).toBe('/automations/a1/edit');
  });

  it('filters runs by status', async () => {
    db.results = {
      automations: {
        data: {
          id: 'a1',
          name: 'Keyword reply',
          trigger_type: 'keyword_match',
        },
        error: null,
      },
      automation_logs: {
        data: [log('l1', 'success'), log('l2', 'failed')],
        error: null,
      },
      conversations: { data: [], error: null },
    };
    await renderLogs();
    await screen.findByText('Keyword reply');
    expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }));
    expect(
      screen
        .getByRole('button', { name: 'Failed 1' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Hide steps' })).toBe(null);
    expect(screen.getAllByRole('button', { name: 'Show steps' })).toHaveLength(
      1
    );
  });
});
