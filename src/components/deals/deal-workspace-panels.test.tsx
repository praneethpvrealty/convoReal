// @vitest-environment happy-dom

// ============================================================
// The Stakeholders and Timeline tabs open on their list, with the add
// form behind a header button; empty Tasks and Documents tabs say what
// happens next and offer the action; timeline entries name who wrote
// them through the shared attribution helpers.
// ============================================================

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DealDocumentsPanel } from '@/components/deals/deal-documents-panel';
import { DealStakeholdersPanel } from '@/components/deals/deal-stakeholders-panel';
import { DealTasksPanel } from '@/components/deals/deal-tasks-panel';
import { DealTimelinePanel } from '@/components/deals/deal-timeline-panel';

const DEAL_ID = 'deal-1';

const STAKEHOLDER = {
  id: 'sh-1',
  name: 'Ravi Kumar',
  role: 'buyer',
  side: 'buyer',
  phone: null,
  email: null,
  links: [],
};

function event(overrides: Record<string, unknown>) {
  return {
    id: 'ev-1',
    account_id: 'acct-1',
    deal_id: DEAL_ID,
    event_type: 'milestone_added',
    source: 'web',
    actor_id: 'user-1',
    actor_name: 'Priya',
    title: 'Token received',
    metadata: {},
    dedupe_key: null,
    visibility: 'internal',
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function mockApi(rows: { stakeholders?: unknown[]; events?: unknown[] } = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return json({ data: {} });
    if (url.endsWith('/stakeholders'))
      return json({ data: rows.stakeholders ?? [] });
    if (url.endsWith('/events')) return json({ data: rows.events ?? [] });
    if (url.startsWith('/api/todos')) return json([]);
    if (url.endsWith('/documents')) return json({ data: [] });
    return json({ data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Stakeholders tab', () => {
  it('lists people first and opens the add form from the header', async () => {
    mockApi({ stakeholders: [STAKEHOLDER] });
    wrap(<DealStakeholdersPanel dealId={DEAL_ID} dealTitle="Plot" canEdit />);
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByLabelText('Name')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Add stakeholder' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('opens the form by default when nobody is on the deal yet, and closes it after an add', async () => {
    const fetchMock = mockApi();
    wrap(<DealStakeholdersPanel dealId={DEAL_ID} dealTitle="Plot" canEdit />);
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Ravi Kumar' } });
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ data: {} });
      if (String(input).endsWith('/stakeholders'))
        return json({ data: [STAKEHOLDER] });
      return json({ data: [] });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save stakeholder' }));
    await screen.findByText('Ravi Kumar');
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
  });

  it('offers no add control to a read-only member', async () => {
    mockApi();
    wrap(
      <DealStakeholdersPanel
        dealId={DEAL_ID}
        dealTitle="Plot"
        canEdit={false}
      />
    );
    await screen.findByText('No stakeholders yet');
    expect(screen.queryByRole('button', { name: 'Add stakeholder' })).toBe(
      null
    );
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});

describe('Timeline tab', () => {
  it('keeps the note composer folded when entries exist', async () => {
    mockApi({ events: [event({})] });
    wrap(<DealTimelinePanel dealId={DEAL_ID} canEdit />);
    await screen.findByText('Token received');
    expect(screen.queryByLabelText('Who can see this note')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Add a note' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Who can see this note')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the note composer on an empty timeline', async () => {
    mockApi();
    wrap(<DealTimelinePanel dealId={DEAL_ID} canEdit />);
    await screen.findByText('Nothing recorded yet.');
    expect(screen.getByLabelText('Who can see this note')).toBeTruthy();
  });

  it('attributes entries with the shared actor and source labels', async () => {
    mockApi({
      events: [
        event({ id: 'a', title: 'Member entry', source: 'mobile' }),
        event({
          id: 'b',
          title: 'Seeded entry',
          source: 'system',
          actor_id: null,
          actor_name: 'Claude (for Priya)',
        }),
      ],
    });
    wrap(<DealTimelinePanel dealId={DEAL_ID} canEdit={false} />);
    await screen.findByText('Member entry');
    expect(screen.getByText('Milestone added · Priya · mobile')).toBeTruthy();
    expect(screen.getByText('Milestone added · System')).toBeTruthy();
    expect(screen.queryByText(/Claude \(for Priya\)/)).toBeNull();
    expect(screen.queryByText(/· system/)).toBeNull();
  });
});

describe('Empty Tasks and Documents tabs', () => {
  it('says where tasks show and focuses the task input', async () => {
    mockApi();
    wrap(
      <DealTasksPanel
        dealId={DEAL_ID}
        contactId={null}
        propertyId={null}
        canEdit
      />
    );
    await screen.findByText('No tasks on this deal');
    expect(
      screen.getByText('Tasks you add here also show in Calendar and Today.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add the first task' }));
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText('What needs doing?')
    );
  });

  it('opens the file picker from the empty documents state', async () => {
    mockApi();
    const { container } = wrap(<DealDocumentsPanel dealId={DEAL_ID} canEdit />);
    await screen.findByText('Nothing filed against this deal yet');
    const picker = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const click = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload a document' }));
    expect(click).toHaveBeenCalled();
  });

  it('hides both actions from a read-only member', async () => {
    mockApi();
    wrap(
      <>
        <DealTasksPanel
          dealId={DEAL_ID}
          contactId={null}
          propertyId={null}
          canEdit={false}
        />
        <DealDocumentsPanel dealId={DEAL_ID} canEdit={false} />
      </>
    );
    await screen.findByText('No tasks on this deal');
    await screen.findByText('Nothing filed against this deal yet');
    expect(screen.queryByRole('button', { name: 'Add the first task' })).toBe(
      null
    );
    expect(screen.queryByRole('button', { name: 'Upload a document' })).toBe(
      null
    );
  });
});
