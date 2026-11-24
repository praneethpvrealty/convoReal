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
import type { Deal, PipelineStage } from '@/types';

const push = vi.fn();
let customerMessages = 0;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'a1' }),
}));
vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseBase: vi.fn(async () => 'https://show.example.com'),
}));
vi.mock('@/lib/conversations/resolve', () => ({
  resolveConversation: vi.fn(async () => ({
    conversation: { id: 'conv1' },
    error: null,
  })),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: async () => ({ count: customerMessages }),
    };
    return { from: () => chain };
  },
}));

import { DealMessageDialog } from './deal-message-dialog';

const stage = {
  id: 's1',
  name: 'Enquiry → Shortlist',
  stage_type: 'open',
} as unknown as PipelineStage;

const deal = {
  id: 'd1',
  title: 'Plot',
  stage_id: 's1',
  status: 'open',
  contact: { id: 'c1', name: 'Anil Reddy', phone: '919800000000' },
  property: { id: 'p1', title: 'KHB Plot', property_code: 'PROP-12' },
} as unknown as Deal;

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DealMessageDialog deal={deal} stage={stage} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  push.mockReset();
});
afterEach(cleanup);

describe('DealMessageDialog', () => {
  it('[PIPE-006] drafts the visit question into an open inbox thread', async () => {
    customerMessages = 1;
    renderDialog();
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect((box as HTMLTextAreaElement).value).toContain(
      'Would you like me to arrange a site visit?'
    );
    fireEvent.click(screen.getByRole('button', { name: /Open in inbox/ }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0][0]).toMatch(/^\/inbox\?c=conv1&draft=Hi%20Anil/);
  });

  it('[PIPE-006] never hands a free-form draft to a closed 24-hour window', async () => {
    customerMessages = 0;
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Open in inbox/ }));
    await screen.findByRole('status');
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'open the chat to pick a template' })
    );
    expect(push).toHaveBeenCalledWith('/inbox?c=conv1');
  });
});
