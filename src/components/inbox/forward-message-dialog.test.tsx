// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The forward dialog in the inbox.
//
// It searches contacts server-side rather than listing them, so the
// assertions that matter are the contract ones: what reaches
// /api/whatsapp/forward, and that a partial result is reported as a
// partial result instead of a flat "sent".
// ============================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render,
  cleanup,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';

import { ForwardMessageDialog } from '@/components/inbox/forward-message-dialog';
import type { Message } from '@/types';

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: toasts }));

const contactRows = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        or: () => ({
          limit: () =>
            Promise.resolve({ data: contactRows.current, error: null }),
        }),
      }),
    }),
  }),
}));

const MESSAGE: Message = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  content_type: 'text',
  content_text:
    'Plot in Koramangala\n\n❌ Delivery Failed:\n[Error 131049] nope',
  status: 'failed',
  created_at: '2026-08-06T07:00:00.000Z',
} as Message;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openWithResults(rows: Array<Record<string, unknown>>) {
  contactRows.current = rows;
  render(<ForwardMessageDialog message={MESSAGE} onOpenChange={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('Search contacts'), {
    target: { value: 'asha' },
  });
}

describe('ForwardMessageDialog', () => {
  it('previews the message without the delivery-failure note', async () => {
    contactRows.current = [];
    render(<ForwardMessageDialog message={MESSAGE} onOpenChange={vi.fn()} />);

    expect(await screen.findByText('Plot in Koramangala')).toBeTruthy();
    expect(screen.queryByText(/Delivery Failed/)).toBeNull();
  });

  it('posts the picked contacts to the forward endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { results: [{ contact_id: 'c-1', name: 'Asha', sent: true }] },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await openWithResults([
      { id: 'c-1', name: 'Asha', phone: '+919876543210', name_tag: null },
    ]);

    fireEvent.click(await screen.findByText('Asha'));
    fireEvent.click(screen.getByRole('button', { name: /Forward to 1/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/whatsapp/forward');
    expect(JSON.parse(init.body)).toEqual({
      message_id: 'msg-1',
      contact_ids: ['c-1'],
    });
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it('warns rather than confirms when only some recipients got it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            results: [
              { contact_id: 'c-1', name: 'Asha', sent: true },
              {
                contact_id: 'c-2',
                name: 'Bala',
                sent: false,
                window_closed: true,
              },
            ],
          },
        }),
      })
    );

    await openWithResults([
      { id: 'c-1', name: 'Asha', phone: '+919876543210', name_tag: null },
      { id: 'c-2', name: 'Bala', phone: '+919876543211', name_tag: null },
    ]);

    fireEvent.click(await screen.findByText('Asha'));
    fireEvent.click(screen.getByText('Bala'));
    fireEvent.click(screen.getByRole('button', { name: /Forward to 2/ }));

    await waitFor(() => expect(toasts.warning).toHaveBeenCalled());
    expect(toasts.success).not.toHaveBeenCalled();
    const [title, opts] = toasts.warning.mock.calls[0];
    expect(title).toBe('Forwarded to 1 of 2');
    expect(opts.description).toContain('Bala');
    expect(toasts.warning.mock.calls[0][1].description).toContain('24-hour');
  });
});
