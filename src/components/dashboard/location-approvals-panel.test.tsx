// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { LocationApprovalsPanel } from './location-approvals-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function row(id: string, status: string, title: string) {
  return {
    id,
    property_id: `prop-${id}`,
    property_title: title,
    property_code: null,
    requester_name: 'Asha',
    requester_phone: '+919800000000',
    identity_protected: false,
    via_contact_name: null,
    status,
    consent_chain: [],
    pending_consent_contact_name: null,
    consent_requested_at: null,
    approved_at: status === 'approved' ? '2026-10-01T10:00:00Z' : null,
    share_sent_at: null,
    view_count: 0,
    created_at: '2026-10-01T09:00:00Z',
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LocationApprovalsPanel', () => {
  it('lists pending requests first and tucks approved ones under a collapsed disclosure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            row('a1', 'approved', 'Approved Villa'),
            row('a2', 'approved', 'Approved Plot'),
            row('p1', 'pending', 'Pending Flat'),
          ],
        }),
      })
    );

    render(<LocationApprovalsPanel />);

    const summary = await screen.findByText('Recently approved (2)');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Approved Villa')).toBeTruthy();
    expect(within(details).getByText('Approved Plot')).toBeTruthy();

    const pending = screen.getByText('Pending Flat');
    expect(details.contains(pending)).toBe(false);
    expect(
      pending.compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy();
  });

  it('shows no disclosure when nothing is approved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [row('p1', 'pending', 'Pending Flat')] }),
      })
    );

    render(<LocationApprovalsPanel />);

    await screen.findByText('Pending Flat');
    expect(screen.queryByText(/Recently approved/)).toBeNull();
  });
});
