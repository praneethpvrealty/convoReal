// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// [TXW-031] The closing checklist reads as a checklist: a tick and a
// title per row, one line of what matters, and the status, visibility
// and due-date controls tucked behind one options button.
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

import { DealMilestonesPanel } from '@/components/deals/deal-milestones-panel';

const PENDING = {
  id: 'm1',
  title: 'Sale agreement signed',
  position: 0,
  status: 'pending',
  target_date: '2026-10-10',
  completed_at: null,
  visibility: 'internal',
  template_key: null,
};
const MILESTONES = [PENDING];

function renderPanel(
  onPatch?: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'PATCH' && onPatch
        ? onPatch()
        : Promise.resolve({
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

  it('[TXW-033] ticks on the spot, locks the row while saving, then refetches', async () => {
    let resolvePatch: (() => void) | null = null;
    const saved = { ...MILESTONES[0], status: 'completed' };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
            (resolve) => {
              resolvePatch = () => {
                MILESTONES.splice(0, 1, saved);
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ data: saved }),
                });
              };
            }
          )
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: [...MILESTONES] }),
          })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DealMilestonesPanel dealId="deal-1" canEdit />
      </QueryClientProvider>
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark completed' })
    );

    const reopen = await screen.findByRole('button', { name: 'Reopen' });
    expect(reopen.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('1 / 1 done')).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([, init]) => !init?.method)
    ).toHaveLength(1);

    resolvePatch!();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Reopen' }).hasAttribute('disabled')
      ).toBe(false)
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => !init?.method).length
      ).toBeGreaterThan(1)
    );
    MILESTONES.splice(0, 1, PENDING);
  });

  it('[TXW-033] locks and rolls back each row on its own while several are in flight', async () => {
    const second = {
      ...PENDING,
      id: 'm2',
      title: 'Registration booked',
      position: 1,
      target_date: null,
    };
    const server = [PENDING, second];
    const settle: Record<string, (ok: boolean) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
              (resolve) => {
                const id = String(url).split('/').pop() as string;
                settle[id] = (ok) => {
                  if (ok) {
                    const at = server.findIndex((row) => row.id === id);
                    server[at] = { ...server[at], status: 'completed' };
                  }
                  resolve({
                    ok,
                    json: () =>
                      Promise.resolve(ok ? { data: {} } : { error: 'Closed' }),
                  });
                };
              }
            )
          : Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ data: [...server] }),
            })
      )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DealMilestonesPanel dealId="deal-1" canEdit />
      </QueryClientProvider>
    );
    const ticks = await screen.findAllByRole('button', {
      name: 'Mark completed',
    });
    fireEvent.click(ticks[0]);
    fireEvent.click(ticks[1]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Reopen' })).toHaveLength(2)
    );
    expect(screen.getByText('2 / 2 done')).toBeTruthy();

    settle.m1!(false);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Mark completed' })
      ).toBeTruthy()
    );
    const stillSaving = screen.getByRole('button', { name: 'Reopen' });
    expect(stillSaving.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('1 / 2 done')).toBeTruthy();

    settle.m2!(true);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Reopen' }).hasAttribute('disabled')
      ).toBe(false)
    );
  });

  it('[TXW-033] puts the row back when the save fails', async () => {
    let failPatch: (() => void) | null = null;
    renderPanel(
      () =>
        new Promise((resolve) => {
          failPatch = () =>
            resolve({
              ok: false,
              json: () => Promise.resolve({ error: 'Deal is closed' }),
            });
        })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark completed' })
    );
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();

    failPatch!();
    expect(
      await screen.findByRole('button', { name: 'Mark completed' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });
});
