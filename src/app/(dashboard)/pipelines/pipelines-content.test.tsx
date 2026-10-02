// @vitest-environment happy-dom

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PipelinesContent from './pipelines-content';

const auth = vi.hoisted(() => ({
  current: {
    user: { id: 'user-1' } as { id: string },
    accountId: 'acct-1',
  },
}));

const calls = vi.hoisted(() => ({ pipelines: 0 }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth.current,
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => true,
}));

vi.mock('@/components/pipelines/pipeline-board', () => ({
  PipelineBoard: ({ onAddDeal }: { onAddDeal: (stageId: string) => void }) => (
    <button type="button" onClick={() => onAddDeal('stage-1')}>
      Add deal from board
    </button>
  ),
}));

vi.mock('@/components/pipelines/pipeline-analytics', () => ({
  PipelineAnalytics: () => null,
}));

vi.mock('@/components/pipelines/pipeline-settings', () => ({
  PipelineSettings: () => null,
}));

vi.mock('@/components/pipelines/deal-form', () => ({
  DealForm: ({ open }: { open: boolean }) => {
    const [title, setTitle] = useState('');
    return open ? (
      <input
        aria-label="Deal title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    ) : null;
  },
}));

const rows: Record<string, unknown> = {
  pipelines: [{ id: 'pipeline-1', name: 'Main', created_at: '2026-01-01' }],
  pipeline_stages: [
    {
      id: 'stage-1',
      pipeline_id: 'pipeline-1',
      name: 'Enquiry',
      position: 0,
      color: '#6366f1',
      stage_type: 'open',
    },
    {
      id: 'stage-lost',
      pipeline_id: 'pipeline-1',
      name: 'Closed Lost',
      position: 1,
      color: '#ef4444',
      stage_type: 'lost',
    },
  ],
  deals: [],
  showcase_settings: null,
};

function query(table: string) {
  if (table === 'pipelines') calls.pipelines += 1;
  const result = { data: rows[table] ?? null, error: null };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  for (const method of [
    'select',
    'eq',
    'in',
    'order',
    'insert',
    'update',
    'single',
    'maybeSingle',
  ]) {
    builder[method] = () => builder;
  }
  return builder;
}

const supabase = {
  from: query,
  rpc: async () => ({ data: [], error: null }),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <PipelinesContent />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
}

afterEach(() => {
  cleanup();
  calls.pipelines = 0;
  auth.current = { user: { id: 'user-1' }, accountId: 'acct-1' };
});

describe('[TXW-028] the Board keeps an open deal form through an auth refresh', () => {
  it('keeps what was typed when the tab regains focus and the session is re-announced', async () => {
    const board = renderBoard();
    fireEvent.click(await screen.findByText('Add deal from board'));
    fireEvent.change(screen.getByLabelText('Deal title'), {
      target: { value: 'KP Anand — Koramangala plot' },
    });

    auth.current = { user: { id: 'user-1' }, accountId: 'acct-1' };
    await act(async () => {
      board.rerender();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.queryByText('Loading pipeline...')).toBeNull();
    expect(screen.getByLabelText('Deal title')).toHaveProperty(
      'value',
      'KP Anand — Koramangala plot'
    );
    expect(calls.pipelines).toBe(1);
  });
});
