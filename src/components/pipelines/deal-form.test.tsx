// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import type { Deal, PipelineStage } from '@/types';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: null }),
}));

const stakeholderLoad = vi.hoisted(() => ({ fails: false }));
const client = vi.hoisted(() => ({
  db: {
    from: (table: string) => {
      const result =
        table === 'deal_stakeholders' && stakeholderLoad.fails
          ? { data: null, error: { message: 'network' } }
          : {
              data:
                table === 'contacts'
                  ? [{ id: 'c1', name: 'Ravi', phone: '91' }]
                  : [],
              error: null,
            };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => client.db,
}));

vi.mock('@/components/pipelines/deal-invoices', () => ({
  DealInvoices: () => null,
}));

import { DealForm } from './deal-form';

const STAGES = [
  { id: 'st1', name: 'New', position: 0, pipeline_id: 'pl1' },
] as PipelineStage[];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function withQueries(ui: ReactElement) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>
  );
}

function renderForm(onOpenChange = vi.fn()) {
  render(
    withQueries(
      <DealForm
        open
        onOpenChange={onOpenChange}
        pipelineId="pl1"
        stages={STAGES}
        onSaved={vi.fn()}
      />
    )
  );
  return onOpenChange;
}

describe('DealForm', () => {
  it('[UIX-032] asks before discarding a typed deal and closes straight away when clean', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const onOpenChange = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Ravi — Lake View' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmMock).toHaveBeenCalledWith(
      'Discard your unsaved changes to this deal?'
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('[UIX-032] asks before discarding a changed currency', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const onOpenChange = renderForm();

    fireEvent.change(screen.getByDisplayValue('INR (₹)'), {
      target: { value: 'AED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmMock).toHaveBeenCalledWith(
      'Discard your unsaved changes to this deal?'
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('[UIX-040] focuses the first missing field when saving an incomplete deal', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderForm();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Ravi — Lake View' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Deal' }));

    expect(toastMock.error).toHaveBeenCalledWith(
      'Title, contact, and stage are required'
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Contact'))
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('[PIPE-007] DealForm other contacts', () => {
  const DEAL = {
    id: 'd1',
    title: 'Ravi — Lake View',
    value: 100,
    currency: 'INR',
    contact_id: 'c1',
    stage_id: 'st1',
    status: 'open',
  } as unknown as Deal;

  function renderEdit() {
    render(
      withQueries(
        <DealForm
          open
          onOpenChange={vi.fn()}
          deal={DEAL}
          pipelineId="pl1"
          stages={STAGES}
          onSaved={vi.fn()}
        />
      )
    );
  }

  it("offers to add another buyer, seller or agent once the deal's contacts have loaded", async () => {
    stakeholderLoad.fails = false;
    renderEdit();
    expect(
      await screen.findByLabelText('Add another contact to this deal')
    ).toBeTruthy();
  });

  it('never offers an edit, and sends no contact list, when the existing contacts failed to load', async () => {
    stakeholderLoad.fails = true;
    const fetchMock = vi.fn(async () => Response.json({ id: 'd1' }));
    vi.stubGlobal('fetch', fetchMock);
    renderEdit();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load this deal'
    );
    expect(
      screen.queryByLabelText('Add another contact to this deal')
    ).toBeNull();
    expect(
      (screen.getByLabelText("Primary contact's role") as HTMLSelectElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save|update/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    );
    expect(body).not.toHaveProperty('participants');
    stakeholderLoad.fails = false;
  });
});
