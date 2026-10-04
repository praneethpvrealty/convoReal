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
import GapsContent from './gaps-content';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EVIDENCE =
  'Looking for a 3BHK near Whitefield, budget 1.2 crore. '.repeat(6);

function gapRow(over: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    kind: 'unmatched_requirement',
    severity: 'high',
    summary: 'Ajay asked for a 3BHK and got nothing',
    evidence: EVIDENCE,
    suggested_action: 'Run matching on this contact and share the shortlist.',
    occurred_at: new Date().toISOString(),
    occurrence_count: 3,
    channel: 'client',
    contact_id: 'c1',
    conversation_id: 'conv1',
    contacts: { id: 'c1', name: 'Ajay' },
    ...over,
  };
}

function renderGaps(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: rows }) }))
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GapsContent />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GapsContent card', () => {
  it('clamps the quoted message and toggles it open and closed', async () => {
    renderGaps([gapRow()]);
    const quote = await waitFor(() => {
      const el = document.querySelector('blockquote');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(quote.className).toContain('line-clamp-2');

    fireEvent.click(screen.getByRole('button', { name: 'Show message' }));
    expect(quote.className).not.toContain('line-clamp-2');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(quote.className).toContain('line-clamp-2');
  });

  it('renders the suggestion as the primary link and keeps the conversation link', async () => {
    renderGaps([gapRow()]);
    const primary = await screen.findByRole('link', {
      name: 'Run matching on this contact and share the shortlist.',
    });
    expect(primary.getAttribute('href')).toBe('/inbox?c=conv1');
    expect(
      screen
        .getByRole('link', { name: /Open the conversation/ })
        .getAttribute('href')
    ).toBe('/inbox?c=conv1');
  });

  it('keeps a suggestion with no destination as plain text', async () => {
    renderGaps([
      gapRow({
        kind: 'bot_handoff',
        suggested_action: 'Teach the bot this fact.',
      }),
    ]);
    await screen.findByText('Teach the bot this fact.');
    expect(
      screen.queryByRole('link', { name: 'Teach the bot this fact.' })
    ).toBe(null);
    expect(
      screen.getByRole('link', { name: /Open the conversation/ })
    ).toBeTruthy();
  });

  it('labels the resolve and dismiss buttons', async () => {
    renderGaps([gapRow()]);
    const resolve = await screen.findByRole('button', {
      name: 'Mark resolved',
    });
    expect(resolve.getAttribute('title')).toBe('Mark resolved');
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss.getAttribute('title')).toBe('Dismiss');
  });

  it('shows contact, kind, age and running days in the header row', async () => {
    renderGaps([gapRow()]);
    await screen.findByText('Ajay');
    expect(screen.getByText('Nothing sent')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
    expect(screen.getByText('3 days running')).toBeTruthy();
  });
});
