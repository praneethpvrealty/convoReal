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

import { DocumentApprovalsPanel } from './document-approvals-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const ROW = {
  id: 'req-1',
  property_id: 'prop-1',
  property_title: 'Lake View',
  property_code: null,
  requester_name: 'Asha',
  requester_phone: '+919800000000',
  requester_email: null,
  status: 'pending',
  share_sent_at: null,
  created_at: '2026-10-01T09:00:00Z',
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentApprovalsPanel />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentApprovalsPanel', () => {
  it('makes Approve & send the primary action and Reject a quiet one beside it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [ROW] }),
      })
    );
    renderPanel();

    const approve = await screen.findByRole('button', {
      name: 'Approve & send',
    });
    const reject = screen.getByRole('button', { name: 'Reject' });

    expect(approve.className).toContain('flex-1');
    expect(reject.className).not.toContain('flex-1');
    expect(reject.className).toContain('text-red-400/80');
    expect(
      approve.compareDocumentPosition(reject) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('still sends each action to the request endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [ROW] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/properties/prop-1/document-requests',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ request_id: 'req-1', action: 'reject' }),
        })
      )
    );
  });
});
