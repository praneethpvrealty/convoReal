// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { NotificationBell } from './notification-bell';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
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

const ROW = {
  id: 'n1',
  type: 'lead',
  title: 'New lead from MagicBricks',
  body: null,
  entity_type: null,
  entity_id: null,
  link: null,
  read_at: null,
  created_at: new Date().toISOString(),
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function readCalls() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/api/notifications/read')
  );
}

describe('[UIX-055] notification bell', () => {
  it('shows a retryable error instead of All caught up when the feed fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    render(<NotificationBell />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn');
    expect(screen.queryByText(/all caught up/)).toBeNull();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [ROW], unreadCount: 1 }), {
        status: 200,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText(ROW.title)).toBeTruthy();
  });

  it('keeps unread items marked while open and marks them read on close', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/read')
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ data: [ROW], unreadCount: 1 }), {
            status: 200,
          })
    );
    render(<NotificationBell />);
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(trigger.textContent).toContain('1'));

    fireEvent.click(trigger);
    await screen.findByText(ROW.title);
    expect(readCalls()).toHaveLength(0);
    expect(trigger.textContent).toContain('1');

    fireEvent.click(trigger);
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(trigger.textContent).not.toContain('1');
  });
});
