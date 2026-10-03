// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Conversation } from '@/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    orgRole: 'org_agent',
    accountId: 'acct-1',
    user: { id: 'u1' },
    profile: { phone: null },
  }),
}));

const fetches = vi.hoisted(() => ({
  resolvers: [] as Array<{
    resolve: (rows: unknown[]) => void;
    reject: (error: unknown) => void;
  }>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        not: () => query,
        order: () => query,
        eq: () => query,
        then: (
          onFulfilled: (value: {
            data: unknown[] | null;
            error: unknown;
          }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          new Promise<unknown[]>((resolve, reject) => {
            fetches.resolvers.push({ resolve, reject });
          })
            .then(
              (rows) => ({ data: rows, error: null }),
              (error) => ({ data: null, error })
            )
            .then(onFulfilled, onRejected),
      };
      return query;
    },
  }),
}));

import { ConversationList } from '@/components/inbox/conversation-list';

function conversation(id: string, name: string): Conversation {
  return {
    id,
    account_id: 'acct-1',
    contact_id: `contact-${id}`,
    status: 'open',
    unread_count: 0,
    is_archived: false,
    last_message_at: '2026-10-03T10:00:00.000Z',
    contact: { id: `contact-${id}`, name, phone: '+919800000001' },
  } as unknown as Conversation;
}

function mount(client: QueryClient, onConversationsLoaded: () => void) {
  return render(
    <QueryClientProvider client={client}>
      <ConversationList
        activeConversationId={null}
        onSelect={() => {}}
        conversations={[]}
        onConversationsLoaded={onConversationsLoaded}
      />
    </QueryClientProvider>
  );
}

const loadingList = () =>
  screen.queryByRole('status', { name: 'Loading conversations' });

afterEach(() => {
  cleanup();
  fetches.resolvers.length = 0;
});

describe('ConversationList', () => {
  it('serves the cached list at once on a return visit and refetches behind it', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = vi.fn();
    const view = mount(client, first);

    expect(loadingList()).toBeTruthy();
    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].resolve([conversation('c1', 'Adithi')]);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(first.mock.calls[0][0]).toHaveLength(1);
    expect(loadingList()).toBeNull();

    view.unmount();

    const second = vi.fn();
    mount(client, second);

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(second.mock.calls[0][0].map((c: Conversation) => c.id)).toEqual([
      'c1',
    ]);
    expect(loadingList()).toBeNull();
    await waitFor(() => expect(fetches.resolvers).toHaveLength(2));

    fetches.resolvers[1].resolve([
      conversation('c2', 'Naveen'),
      conversation('c1', 'Adithi'),
    ]);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(2));
    expect(second.mock.calls[1][0].map((c: Conversation) => c.id)).toEqual([
      'c2',
      'c1',
    ]);
  });

  it('shows the empty state, not the skeleton, when the fetch fails', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onLoaded = vi.fn();
    mount(client, onLoaded);

    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].reject({
      message: 'permission denied',
      details: '',
      hint: '',
      code: '42501',
    });

    await waitFor(() => expect(loadingList()).toBeNull());
    expect(screen.getByText('No conversations found')).toBeTruthy();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      'Failed to fetch conversations:',
      expect.objectContaining({ code: '42501' })
    );
    logged.mockRestore();
  });
});
