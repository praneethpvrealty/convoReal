// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  status: 'sending',
  recipientFetches: 0,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'b1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/components/reengagement/reengagement-outcome', () => ({
  ReengagementOutcome: () => null,
}));

vi.mock('@/components/contacts/name-tag-badge', () => ({
  NameTagBadge: () => null,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
        builder[method] = () => builder;
      }
      builder.single = async () => ({
        data: {
          id: 'b1',
          name: 'Diwali offer',
          status: db.status,
          template_name: 'diwali_offer',
          total_recipients: 1,
          sent_count: 1,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
          created_at: '2026-10-01T09:00:00Z',
        },
        error: null,
      });
      builder.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'broadcast_recipients') db.recipientFetches += 1;
        return resolve({ data: [], error: null });
      };
      return builder;
    },
  }),
}));

import BroadcastDetailPage from './page';

afterEach(() => {
  cleanup();
  db.status = 'sending';
  db.recipientFetches = 0;
});

describe('BroadcastDetailPage', () => {
  it('reloads the recipients once more when sending finishes', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <BroadcastDetailPage />
      </QueryClientProvider>
    );
    await screen.findAllByText('Diwali offer');
    await waitFor(() => expect(db.recipientFetches).toBe(1));

    db.status = 'sent';
    await act(async () => {
      await client.refetchQueries({ queryKey: ['broadcast', 'b1'] });
    });

    await waitFor(() => expect(db.recipientFetches).toBe(2));
  });
});
