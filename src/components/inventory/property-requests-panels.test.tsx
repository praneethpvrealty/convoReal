// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { Property } from '@/types';
import { PropertyRequestsPanels } from './property-requests-panels';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'viewer' }, accountId: 'acct-1' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const PROPERTY = { id: 'prop-1', title: 'Lakeview Villa' } as Property;

const DOC_REQUESTS = [
  {
    id: 'req-1',
    requester_name: 'Ravi Requester',
    requester_phone: '+919800000001',
    requester_email: null,
    status: 'pending',
    share_token: null,
    share_token_expires_at: null,
    share_sent_at: null,
    viewed_at: null,
    view_count: 0,
    last_viewed_at: null,
    created_at: '2026-09-01T10:00:00Z',
  },
];

const LOC_REQUESTS = [
  {
    id: 'loc-1',
    requester_name: 'Meera Walker',
    requester_phone: '+919800000002',
    status: 'pending',
    identity_protected: true,
    via_contact_id: 'c-9',
    pending_consent_contact_id: 'c-9',
    share_token: null,
    share_token_expires_at: null,
    share_sent_at: null,
    view_count: 0,
    last_viewed_at: null,
    created_at: '2026-09-02T10:00:00Z',
  },
];

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function mockApi() {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') return json({});
    if (url.endsWith('/document-requests')) return json({ data: DOC_REQUESTS });
    if (url.endsWith('/location-requests')) return json({ data: LOC_REQUESTS });
    return json({ error: `unexpected ${url}` }, false);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PropertyRequestsPanels', () => {
  it('lists pending document and location requests for the property', async () => {
    const fetchMock = mockApi();

    render(<PropertyRequestsPanels property={PROPERTY} refreshKey={0} />);

    expect(await screen.findByText('Ravi Requester')).toBeTruthy();
    expect(await screen.findByText('Meera Walker')).toBeTruthy();
    expect(screen.getByText(/Awaiting co-broker/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/properties/prop-1/document-requests'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/properties/prop-1/location-requests'
    );
  });

  it('approves a document request with a PATCH and reloads the list', async () => {
    const fetchMock = mockApi();

    render(<PropertyRequestsPanels property={PROPERTY} refreshKey={0} />);
    await screen.findByText('Ravi Requester');

    const approve = screen
      .getAllByRole('button', { name: /Approve & Send/ })
      .find((button) => !button.hasAttribute('disabled'));
    expect(approve).toBeTruthy();
    fireEvent.click(approve!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/properties/prop-1/document-requests',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ request_id: 'req-1', action: 'approve' }),
        })
      );
    });
    await waitFor(() => {
      const docLoads = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/document-requests') && !init?.method
      );
      expect(docLoads.length).toBe(2);
    });
  });

  it('reloads document requests when the refresh key changes', async () => {
    const fetchMock = mockApi();

    const view = render(
      <PropertyRequestsPanels property={PROPERTY} refreshKey={0} />
    );
    await screen.findByText('Ravi Requester');

    view.rerender(
      <PropertyRequestsPanels property={PROPERTY} refreshKey={1} />
    );

    await waitFor(() => {
      const docLoads = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/document-requests') && !init?.method
      );
      expect(docLoads.length).toBe(2);
    });
  });
});
