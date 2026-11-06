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

const calls = vi.hoisted(() => ({
  pipelines: 0,
  holdPipelines: null as Promise<void> | null,
  failing: new Set<string>(),
  inserts: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth.current,
}));

vi.mock('@/hooks/useCan', () => ({
  useCan: () => true,
}));

vi.mock('@/components/pipelines/pipeline-board', () => ({
  PipelineBoard: ({
    onAddDeal,
    onDealMoved,
    deals,
  }: {
    onAddDeal: (stageId: string) => void;
    onDealMoved: (dealId: string, stageId: string) => void;
    deals: Array<{ id: string; stage_id: string }>;
  }) => (
    <>
      <button type="button" onClick={() => onAddDeal('stage-1')}>
        Add deal from board
      </button>
      {deals.map((deal) => (
        <button
          key={deal.id}
          type="button"
          onClick={() => onDealMoved(deal.id, 'stage-2')}
        >
          {`${deal.id} in ${deal.stage_id}`}
        </button>
      ))}
    </>
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
  const held = table === 'pipelines' ? calls.holdPipelines : null;
  if (table === 'pipelines') calls.pipelines += 1;
  const result = calls.failing.has(table)
    ? { data: null, error: { message: 'network down' } }
    : { data: rows[table] ?? null, error: null };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) =>
      held ? held.then(() => resolve(result)) : resolve(result),
  };
  builder.insert = () => {
    calls.inserts.push(table);
    return builder;
  };
  for (const method of [
    'select',
    'eq',
    'in',
    'order',
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
  rpc: async (): Promise<{ data: unknown; error: null }> => ({
    data: [],
    error: null,
  }),
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
  calls.holdPipelines = null;
  calls.failing.clear();
  calls.inserts = [];
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

  it("hides the previous user's board until the new user's pipelines load", async () => {
    const board = renderBoard();
    await screen.findByText('Add deal from board');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    let release = () => {};
    calls.holdPipelines = new Promise<void>((resolve) => {
      release = resolve;
    });
    auth.current = { user: { id: 'user-2' }, accountId: 'acct-1' };
    await act(async () => {
      board.rerender();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(calls.pipelines).toBe(2);
    expect(screen.queryByText('Add deal from board')).toBeNull();
    expect(screen.getByText('Loading pipeline...')).toBeTruthy();

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText('Add deal from board')).toBeTruthy();
  });
});

describe('[PIPE-005] a failed load never seeds a pipeline', () => {
  it('shows a retry state instead of creating a default pipeline', async () => {
    calls.failing.add('pipelines');
    renderBoard();
    expect(
      await screen.findByText(/Couldn.t load your pipelines/)
    ).toBeTruthy();
    expect(calls.inserts).toEqual([]);
    expect(screen.queryByText('Add deal from board')).toBeNull();

    calls.failing.delete('pipelines');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Add deal from board')).toBeTruthy();
    expect(calls.inserts).toEqual([]);
  });

  it('shows a retry state when the stages or deals fail to load', async () => {
    calls.failing.add('deals');
    renderBoard();
    expect(
      await screen.findByText(/Couldn.t load this pipeline.s stages and deals/)
    ).toBeTruthy();
    expect(screen.queryByText('Add deal from board')).toBeNull();

    calls.failing.delete('deals');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Add deal from board')).toBeTruthy();
  });
});

describe('[PIPE-005] a failed move puts the deal back', () => {
  it('restores the stage even when the follow-up refresh fails too', async () => {
    const stages = rows.pipeline_stages as Array<Record<string, unknown>>;
    const original = { stages: rows.pipeline_stages, deals: rows.deals };
    rows.pipeline_stages = [
      ...stages,
      {
        id: 'stage-2',
        pipeline_id: 'pipeline-1',
        name: 'Site visit',
        position: 2,
        color: '#22c55e',
        stage_type: 'open',
      },
    ];
    rows.deals = [
      {
        id: 'deal-1',
        pipeline_id: 'pipeline-1',
        stage_id: 'stage-1',
        status: 'open',
        brokerage_amount: 1000,
      },
    ];
    const fetchMock = vi.fn(async () => {
      calls.failing.add('deals');
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rpc = supabase.rpc;
    supabase.rpc = async () => ({ data: ['deal-1'], error: null });
    try {
      renderBoard();
      fireEvent.click(await screen.findByText('deal-1 in stage-1'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(fetchMock).toHaveBeenCalled();
      expect(screen.getByText('deal-1 in stage-1')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      supabase.rpc = rpc;
      rows.pipeline_stages = original.stages;
      rows.deals = original.deals;
    }
  });
});
