// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  render,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Conversation } from '@/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    orgRole: 'org_agent',
    accountId: 'acct-1',
    user: { id: 'u1' },
    profile: { phone: null },
  }),
}));

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

const fetches = vi.hoisted(() => ({
  resolvers: [] as Array<{
    calls: Array<[string, unknown[]]>;
    resolve: (rows: unknown) => void;
    reject: (error: unknown) => void;
  }>,
  updates: [] as Array<{
    patch: unknown;
    result: { data: unknown[] | null; error: unknown };
  }>,
  undoResult: { data: [{ id: 'c1' }], error: null } as {
    data: unknown[] | null;
    error: unknown;
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => {
      const calls: Array<[string, unknown[]]> = [];
      let patch: unknown = null;
      const settle = (single: boolean) => {
        if (patch !== null) {
          const result =
            (patch as { is_archived: boolean }).is_archived === false
              ? fetches.undoResult
              : { data: [{ id: 'c1' }], error: null };
          fetches.updates.push({ patch, result });
          return Promise.resolve(result);
        }
        return new Promise<unknown>((resolve, reject) => {
          fetches.resolvers.push({ calls, resolve, reject });
        }).then(
          (rows) => ({
            data: single ? ((rows as unknown[])[0] ?? null) : rows,
            error: null,
          }),
          (error) => ({ data: null, error })
        );
      };
      const query: Record<string, unknown> = {};
      for (const method of [
        'select',
        'not',
        'order',
        'eq',
        'neq',
        'gt',
        'is',
        'lt',
        'in',
        'or',
        'range',
        'limit',
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return query;
        };
      }
      query.update = (value: unknown) => {
        patch = value;
        return query;
      };
      query.maybeSingle = () => {
        calls.push(['maybeSingle', []]);
        return settle(true);
      };
      query.then = (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => settle(false).then(onFulfilled, onRejected);
      return query;
    },
  }),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

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
  fetches.updates.length = 0;
  fetches.undoResult = { data: [{ id: 'c1' }], error: null };
  search.params = new URLSearchParams();
  toasts.success.mockReset();
  toasts.error.mockReset();
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

  it('[UIX-012] shows a retryable error, not the empty state, when the fetch fails', async () => {
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
    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't load conversations"
    );
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
    expect(screen.queryByText('No conversations found')).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      'Failed to fetch conversations:',
      expect.objectContaining({ code: '42501' })
    );
    logged.mockRestore();
  });

  it('[UIX-012] fetches a deep-linked conversation that is missing from the page, even with no messages', async () => {
    search.params = new URLSearchParams('c=draft-1');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onLoaded = vi.fn();
    mount(client, onLoaded);

    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    const page = fetches.resolvers[0];
    expect(page.calls).toContainEqual(['limit', [50]]);
    expect(page.calls.some(([method]) => method === 'range')).toBe(false);
    page.resolve([conversation('c1', 'Adithi')]);

    await waitFor(() => expect(fetches.resolvers).toHaveLength(2));
    const pinned = fetches.resolvers[1];
    expect(pinned.calls).toContainEqual(['eq', ['id', 'draft-1']]);
    expect(pinned.calls.some(([method]) => method === 'not')).toBe(false);
    pinned.resolve([
      { ...conversation('draft-1', 'Naveen'), last_message_at: null },
    ]);

    await waitFor(() =>
      expect(
        onLoaded.mock.calls.at(-1)?.[0].map((c: Conversation) => c.id)
      ).toEqual(['draft-1', 'c1'])
    );
  });

  it('[UIX-012] offers a retry when the deep-linked conversation lookup fails', async () => {
    search.params = new URLSearchParams('c=draft-1');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(client, vi.fn());

    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].resolve([conversation('c1', 'Adithi')]);
    await waitFor(() => expect(fetches.resolvers).toHaveLength(2));
    fetches.resolvers[1].reject({ message: 'network down' });

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load conversations"
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() =>
      expect(
        fetches.resolvers.filter(({ calls }) =>
          calls.some(
            ([method, args]) =>
              method === 'eq' && args[0] === 'id' && args[1] === 'draft-1'
          )
        )
      ).toHaveLength(2)
    );
  });

  it('[UIX-012] pages the list and offers Load more while a page comes back full', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rows = Array.from({ length: 50 }, (_, i) =>
      conversation(`c${i}`, `Lead ${i}`)
    );
    render(
      <QueryClientProvider client={client}>
        <ConversationList
          activeConversationId={null}
          onSelect={() => {}}
          conversations={rows}
          onConversationsLoaded={() => {}}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].resolve(rows);

    const more = await screen.findByRole('button', { name: 'Load more' });
    fireEvent.click(more);
    await waitFor(() => expect(fetches.resolvers).toHaveLength(2));
    expect(fetches.resolvers[1].calls).toContainEqual([
      'or',
      [
        'last_message_at.lt."2026-10-03T10:00:00.000Z",last_message_at.is.null,and(last_message_at.eq."2026-10-03T10:00:00.000Z",id.lt."c49")',
      ],
    ]);
    fetches.resolvers[1].resolve([conversation('c50', 'Last')]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    );
  });

  it('[UIX-012] searches on the server so a thread beyond the loaded page is found', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <ConversationList
          activeConversationId={null}
          onSelect={() => {}}
          conversations={[]}
          onConversationsLoaded={() => {}}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].resolve([]);

    fireEvent.change(view.getByPlaceholderText('Search conversations...'), {
      target: { value: 'Ravi' },
    });
    await waitFor(() =>
      expect(
        fetches.resolvers.some(({ calls }) =>
          calls.some(
            ([method, args]) =>
              method === 'or' &&
              (args[1] as { referencedTable?: string } | undefined)
                ?.referencedTable === 'contacts'
          )
        )
      ).toBe(true)
    );
    const contactLookup = fetches.resolvers.find(({ calls }) =>
      calls.some(
        ([method, args]) =>
          method === 'select' && args[0] === 'id, contacts!inner(id)'
      )
    )!;
    contactLookup.resolve([{ id: 'far-away' }]);

    await waitFor(() =>
      expect(
        fetches.resolvers.some(({ calls }) =>
          calls.some(
            ([method, args]) =>
              method === 'or' && String(args[0]).includes('id.in.(far-away)')
          )
        )
      ).toBe(true)
    );
  });

  it('[UIX-012] tells the agent when undoing an archive fails', async () => {
    fetches.undoResult = { data: null, error: { message: 'denied' } };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onArchiveChange = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <ConversationList
          activeConversationId={null}
          onSelect={() => {}}
          conversations={[
            { ...conversation('c1', 'Adithi'), assigned_agent_id: 'u1' },
          ]}
          onConversationsLoaded={() => {}}
          onArchiveChange={onArchiveChange}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetches.resolvers).toHaveLength(1));
    fetches.resolvers[0].resolve([conversation('c1', 'Adithi')]);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Conversation options' })
    );
    fireEvent.click(await screen.findByText('Archive'));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(onArchiveChange).toHaveBeenCalledWith('c1', true);

    const options = toasts.success.mock.calls[0][1] as {
      action: { onClick: () => Promise<void> };
    };
    await options.action.onClick();
    expect(toasts.error).toHaveBeenCalledWith(
      expect.stringContaining('still archived')
    );
    expect(onArchiveChange).toHaveBeenCalledTimes(1);
  });
});
