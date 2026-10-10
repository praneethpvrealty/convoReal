// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DocumentApprovalsPanel } from './document-approvals-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function row(
  id: string,
  overrides: Partial<{
    status: string;
    created_at: string;
    decided_at: string | null;
    document_count: number;
    requester_name: string;
    requester_phone: string;
    requester_email: string | null;
    property_title: string;
    share_sent_at: string | null;
  }> = {}
) {
  return {
    id,
    property_id: `prop-${id}`,
    property_title: `Plot ${id}`,
    property_code: `PROP-${id}`,
    document_count: 2,
    requester_name: 'Pavan',
    requester_phone: '+917353838484',
    requester_email: 'business@kyzion.com',
    status: 'pending',
    share_sent_at: null,
    created_at: '2026-10-10T09:00:00Z',
    decided_at: null,
    ...overrides,
  };
}

function renderPanel(rows: ReturnType<typeof row>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentApprovalsPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DocumentApprovalsPanel', () => {
  it('[DOC-003] shows one card per requester with every property and bulk actions', async () => {
    renderPanel([
      row('1056', { created_at: '2026-10-10T09:02:22Z' }),
      row('1136', { created_at: '2026-10-10T09:02:57Z' }),
      row('77', {
        requester_name: 'Asha',
        requester_phone: '+919800000000',
        requester_email: null,
        created_at: '2026-10-10T08:00:00Z',
      }),
    ]);

    await screen.findByText('Plot 1136');
    expect(screen.getAllByText('Pavan')).toHaveLength(1);
    expect(screen.getByText('business@kyzion.com')).toBeTruthy();
    expect(screen.getByText('2 properties')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve all 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject all' })).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Approve & send 2 docs' })
    ).toHaveLength(3);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('[DOC-001] marks a request older than a week as timed out and demotes its actions', async () => {
    renderPanel([row('old', { created_at: '2026-08-12T09:02:57Z' })]);

    await screen.findByText('Plot old');
    expect(screen.getByText('Timed out · 59 days')).toBeTruthy();
    expect(
      screen.getByText('The requester may have moved on since asking.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('[DOC-002] warns when the listing has no documents and links to upload them', async () => {
    renderPanel([row('empty', { document_count: 0 })]);

    await screen.findByText('Plot empty');
    expect(screen.getByText('No documents uploaded')).toBeTruthy();
    expect(
      screen.getByText(/Approving sends a note that they are being prepared/)
    ).toBeTruthy();
    const upload = screen.getByRole('link', { name: 'Upload documents' });
    expect(upload.getAttribute('href')).toBe(
      '/inventory?propertyId=PROP-empty'
    );
    expect(
      screen.getByRole('button', { name: 'Approve without documents' })
    ).toBeTruthy();
  });

  it('[DOC-003] tucks decided requests under a collapsed disclosure with their outcome', async () => {
    renderPanel([
      row('p'),
      row('sent', {
        status: 'approved',
        share_sent_at: '2026-10-09T10:00:00Z',
        decided_at: '2026-10-09T10:00:00Z',
        property_title: 'Sent Villa',
      }),
      row('no', {
        status: 'rejected',
        decided_at: '2026-10-08T10:00:00Z',
        property_title: 'Rejected Flat',
      }),
    ]);

    const summary = await screen.findByText('Recently decided (2)');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Sent Villa')).toBeTruthy();
    expect(within(details).getByText('Link sent')).toBeTruthy();
    expect(within(details).getByText('Rejected Flat')).toBeTruthy();
    expect(within(details).getByText('Rejected')).toBeTruthy();
    expect(within(details).queryByRole('button')).toBeNull();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('[DOC-003] approve-all decides every listing in the card, documents or not', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ delivered: true }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            row('docs', { document_count: 2 }),
            row('none', { document_count: 0 }),
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DocumentApprovalsPanel />
      </QueryClientProvider>
    );

    const approveAll = await screen.findByRole('button', {
      name: 'Approve all 2',
    });
    expect((approveAll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approveAll);

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'PATCH'
      );
      expect(patches.map(([url]) => url)).toEqual([
        '/api/properties/prop-docs/document-requests',
        '/api/properties/prop-none/document-requests',
      ]);
      expect(
        patches.map(([, init]) => JSON.parse(String(init?.body)).action)
      ).toEqual(['approve', 'approve']);
    });
  });

  it('renders nothing when there are no requests at all', async () => {
    const { container } = renderPanel([]);
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });
});
