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
import AutomationsListContent from './automations-list-content';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const can = vi.hoisted(() => ({ value: true }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1', user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useCan', () => ({ useCan: () => can.value }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function automation(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    account_id: 'acct-1',
    user_id: 'u1',
    name: 'Welcome new leads',
    trigger_type: 'new_contact_created',
    trigger_config: {},
    is_active: false,
    execution_count: 12,
    last_executed_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function renderList(handler: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    handler(url, init)
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AutomationsListContent />
    </QueryClientProvider>
  );
  return fetchMock;
}

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  can.value = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('AutomationsListContent', () => {
  it('lists each automation with its trigger label, runs and actions', async () => {
    renderList(() => ok({ automations: [automation()] }));
    await screen.findByText('Welcome new leads');
    expect(screen.getByText('New Contact')).toBeTruthy();
    expect(screen.getByText(/12 runs · Last run 2h ago/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Logs/ }).getAttribute('href')
    ).toBe('/automations/a1/logs');
    expect(
      screen
        .getAllByRole('link', { name: /Edit/ })
        .some((l) => l.getAttribute('href') === '/automations/a1/edit')
    ).toBe(true);
  });

  it('explains what an automation is when there are none', async () => {
    renderList(() => ok({ automations: [] }));
    await screen.findByText('No automations yet');
    expect(screen.getByText(/watches for an event/)).toBeTruthy();
  });

  it('shows a retryable error instead of an empty list when loading fails', async () => {
    let fail = true;
    renderList(() =>
      fail
        ? { ok: false, json: async () => ({}) }
        : ok({ automations: [automation()] })
    );
    await screen.findByText(/Couldn.t load your automations/);
    expect(screen.queryByText('No automations yet')).toBe(null);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Welcome new leads');
  });

  it('shows the validation issues the route returns when turning one on fails', async () => {
    const fetchMock = renderList((url, init) => {
      if (init?.method === 'PATCH') {
        return {
          ok: false,
          json: async () => ({
            error: 'Cannot keep automation active with invalid configuration',
            issues: [{ path: 'steps', message: 'Add at least one step.' }],
          }),
        };
      }
      return ok({ automations: [automation()] });
    });
    const toggle = await screen.findByRole('switch', {
      name: 'Turn on Welcome new leads',
    });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await screen.findByText('Add at least one step.');
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(patch?.[0]).toBe('/api/automations/a1');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ is_active: true });
  });

  it('asks for confirmation with the trigger sentence before turning one on', async () => {
    const fetchMock = renderList((url, init) =>
      init?.method === 'PATCH'
        ? ok({ ok: true })
        : ok({ automations: [automation()] })
    );
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Turn on Welcome new leads' })
    );
    await screen.findByText('Turn on “Welcome new leads”?');
    expect(
      screen.getByText(/This will run for every new contact/)
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Turn on “Welcome new leads”?')).toBe(null)
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);

    fireEvent.click(
      screen.getByRole('switch', { name: 'Turn on Welcome new leads' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      ).toBeTruthy()
    );
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ is_active: true });
  });

  it('pauses immediately without a confirmation', async () => {
    const fetchMock = renderList((url, init) =>
      init?.method === 'PATCH'
        ? ok({ ok: true })
        : ok({ automations: [automation({ is_active: true })] })
    );
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Pause Welcome new leads' })
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      ).toBeTruthy()
    );
    expect(screen.queryByText(/Turn on “/)).toBe(null);
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ is_active: false });
  });

  it('marks an unavailable trigger and will not turn it on', async () => {
    renderList(() =>
      ok({ automations: [automation({ trigger_type: 'tag_added' })] })
    );
    await screen.findByText('Tag Added (not yet available)');
    const toggle = screen.getByRole('switch', {
      name: 'Turn on Welcome new leads',
    });
    expect(
      toggle.hasAttribute('disabled') ||
        toggle.getAttribute('aria-disabled') === 'true' ||
        toggle.hasAttribute('data-disabled')
    ).toBe(true);
    expect(toggle.closest('[title]')?.getAttribute('title')).toMatch(
      /not yet available/
    );
  });

  it("gives a teammate's automation the same actions as the caller's own", async () => {
    renderList(() =>
      ok({ automations: [automation({ user_id: 'u2', is_active: true })] })
    );
    await screen.findByText('Welcome new leads');
    const toggle = screen.getByRole('switch', {
      name: 'Pause Welcome new leads',
    });
    expect(toggle.getAttribute('aria-disabled')).not.toBe('true');
    expect(
      screen
        .getAllByRole('link', { name: /Edit/ })
        .some((l) => l.getAttribute('href') === '/automations/a1/edit')
    ).toBe(true);
    expect(
      screen
        .getByRole('link', { name: 'Welcome new leads' })
        .getAttribute('href')
    ).toBe('/automations/a1/edit');
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy();
    expect(screen.queryByText(/Created by a teammate/)).toBe(null);
  });

  it('shows a read-only member every automation without the actions', async () => {
    can.value = false;
    renderList(() =>
      ok({ automations: [automation({ user_id: 'u2', is_active: true })] })
    );
    await screen.findByText('Welcome new leads');
    const toggle = screen.getByRole('switch', {
      name: 'Pause Welcome new leads',
    });
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.closest('[title]')?.getAttribute('title')).toBe(
      'Your access is read-only.'
    );
    expect(screen.queryByRole('link', { name: /Edit/ })).toBe(null);
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBe(null);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBe(null);
    expect(
      screen.getByRole('link', { name: /Logs/ }).getAttribute('href')
    ).toBe('/automations/a1/logs');
  });

  it('deletes only after the confirm dialog', async () => {
    const fetchMock = renderList((url, init) =>
      init?.method === 'DELETE'
        ? ok({ ok: true })
        : ok({ automations: [automation()] })
    );
    await screen.findByText('Welcome new leads');
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await screen.findByText('Delete automation?');
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')
    ).toBe(false);
    const dialogButtons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() =>
      expect(screen.queryByText('Welcome new leads')).toBe(null)
    );
    expect(
      fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[0]
    ).toBe('/api/automations/a1');
  });

  it('duplicates through the duplicate route', async () => {
    const fetchMock = renderList((url, init) =>
      init?.method === 'POST'
        ? ok({ automation: automation({ id: 'a2' }) })
        : ok({ automations: [automation()] })
    );
    await screen.findByText('Welcome new leads');
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]
      ).toBe('/api/automations/a1/duplicate')
    );
  });
});
