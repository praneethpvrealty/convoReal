// @vitest-environment happy-dom

// ============================================================
// The escape hatch on a call update.
//
// Meta only allows free-form text inside the 24-hour customer service
// window, and a call update is different prose every time, so the
// Engine send is refused more often than it succeeds. The way out is
// the agent's own WhatsApp: no window, no template approval, and the
// line breaks survive — a template body parameter may not contain them.
// These pin that the hand-off carries the draft verbatim, that the
// Engine never claims a message it cannot see was delivered, and that
// the control is absent when there is no number to open.
// ============================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { CallLog } from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { CallAnalysisSection } from './call-analysis';

const DRAFT =
  'Dear Chetan Kumar,\nI just spoke with Prasad.\n\nSite visit this week.';

const call = {
  id: 'call-1',
  account_id: 'acct-1',
  contact_id: 'contact-1',
  user_id: 'user-1',
  called_at: '2026-08-05T10:00:00Z',
  direction: 'outgoing',
  duration_seconds: 300,
  outcome: 'connected',
  notes: null,
  summary: 'Owner returning on the 5th.',
  update_draft: DRAFT,
  created_at: '2026-08-05T10:00:00Z',
} as unknown as CallLog;

let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal('open', open);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderSection(phone: string, onUpdated = vi.fn()) {
  render(
    <CallAnalysisSection
      contactId="contact-1"
      call={call}
      contactName="Chetan Kumar"
      contactPhone={phone}
      onUpdated={onUpdated}
    />
  );
  return onUpdated;
}

describe('call update — sending from the agent’s own WhatsApp', () => {
  it('opens wa.me with the draft, newlines intact', () => {
    renderSection('+91 98765 43210');

    fireEvent.click(screen.getByRole('button', { name: /my whatsapp/i }));

    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(open.mock.calls[0][0] as string);
    // Digits only — wa.me rejects the spaces and the leading plus.
    expect(url.pathname).toBe('/919876543210');
    // The paragraph breaks are the reason this route exists: a template
    // body parameter cannot carry them.
    expect(url.searchParams.get('text')).toBe(DRAFT);
  });

  it('offers nothing to open when the contact has no number', () => {
    renderSection('');
    expect(screen.queryByRole('button', { name: /my whatsapp/i })).toBeNull();
  });

  it('does not mark the update sent on the way out', () => {
    // The deep link cannot report back, so claiming delivery here would
    // stamp updates the agent abandoned in WhatsApp.
    renderSection('+919876543210');

    fireEvent.click(screen.getByRole('button', { name: /my whatsapp/i }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /mark as sent/i })).toBeTruthy();
  });

  it('records it only once the agent confirms', async () => {
    const onUpdated = renderSection('+919876543210');

    fireEvent.click(screen.getByRole('button', { name: /my whatsapp/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark as sent/i }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe('/api/contacts/contact-1/calls/call-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({ mark_sent: true });
  });

  it('leaves the row alone when the agent backs out', () => {
    renderSection('+919876543210');

    fireEvent.click(screen.getByRole('button', { name: /my whatsapp/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /mark as sent/i })).toBeNull();
  });
});
