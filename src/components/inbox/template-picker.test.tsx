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

const db = vi.hoisted(() => ({
  result: { data: [] as unknown[] | null, error: null as unknown },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve(db.result),
      };
      return query;
    },
  }),
}));

import { TemplatePicker } from './template-picker';

const greeting = {
  id: 't1',
  name: 'welcome_note',
  category: 'UTILITY',
  language: 'en',
  status: 'APPROVED',
  body_text: 'Thanks for reaching out to us.',
  footer_text: 'Reply STOP to opt out',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Book a visit' },
    { type: 'URL', text: 'See listings', url: 'https://example.com' },
  ],
};

function renderPicker(onSelect = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TemplatePicker open onOpenChange={() => {}} onSelect={onSelect} />
    </QueryClientProvider>
  );
  return onSelect;
}

afterEach(() => {
  cleanup();
  db.result = { data: [], error: null };
});

describe('TemplatePicker', () => {
  it('[UIX-012] shows a retryable error, not No approved templates, when loading fails', async () => {
    db.result = { data: null, error: { message: 'offline' } };
    renderPicker();
    expect(await screen.findByText("Couldn't load templates.")).toBeTruthy();
    expect(screen.queryByText('No approved templates')).toBeNull();

    db.result = { data: [greeting], error: null };
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('welcome_note')).toBeTruthy();
  });

  it('[UIX-012] previews a template with no variables, including its buttons, before sending', async () => {
    db.result = { data: [greeting], error: null };
    const onSelect = renderPicker();
    fireEvent.click(await screen.findByText('welcome_note'));

    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('Thanks for reaching out to us.')).toBeTruthy();
    const buttons = screen.getByRole('list', { name: 'Template buttons' });
    expect(buttons.textContent).toContain('Book a visit');
    expect(buttons.textContent).toContain('See listings');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
        { body: [] }
      )
    );
  });
});
