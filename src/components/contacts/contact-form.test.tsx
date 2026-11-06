// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Contact } from '@/types';

const db = vi.hoisted(() => ({
  linksError: null as unknown,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, accountId: 'acct-1' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const client = vi.hoisted(() => ({
  from: (table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      eq: () => query,
      limit: () => query,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === 'properties' && db.linksError
            ? { data: null, error: db.linksError }
            : { data: [], error: null }
        ).then(resolve),
    };
    return query;
  },
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => client }));

const Nothing = vi.hoisted(() => () => null);
vi.mock('@/components/contacts/areas-of-interest-input', () => ({
  AreasOfInterestInput: Nothing,
}));
vi.mock('@/components/contacts/projects-of-interest-input', () => ({
  ProjectsOfInterestInput: Nothing,
}));
vi.mock('@/components/contacts/alerts-consent-control', () => ({
  AlertsConsentControl: Nothing,
}));

import { ContactForm } from './contact-form';

const owner = {
  id: 'c1',
  name: 'Meera',
  phone: '+919800000000',
  classification: 'Owner & Buyer',
  secondary_phones: [],
} as unknown as Contact;

function renderForm(onOpenChange = vi.fn()) {
  render(
    <ContactForm
      open
      onOpenChange={onOpenChange}
      contact={owner}
      contactTags={[]}
      onSaved={() => {}}
    />
  );
  return onOpenChange;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.linksError = null;
});

describe('ContactForm', () => {
  it('[UIX-013] leaves property_ids out of the save when the linked properties failed to load', async () => {
    db.linksError = { message: 'offline' };
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderForm();

    expect(
      await screen.findByText(/Couldn’t load the linked properties/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, { body: string }]
    >;
    const body = JSON.parse(calls[0][1].body);
    expect('property_ids' in body).toBe(false);
  });

  it('[UIX-013] asks before Cancel throws away edits, and closes at once when nothing changed', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const onOpenChange = renderForm();
    const name = (await screen.findByDisplayValue('Meera')) as HTMLInputElement;

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(confirm).not.toHaveBeenCalled();
    onOpenChange.mockClear();

    fireEvent.change(name, { target: { value: 'Meera K' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledWith('Discard changes?');
    expect(onOpenChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('[UIX-013] blocks saving a minimum budget above the maximum', async () => {
    renderForm();
    fireEvent.change(await screen.findByPlaceholderText('Min Budget'), {
      target: { value: '9000000' },
    });
    fireEvent.change(screen.getByPlaceholderText('Max Budget'), {
      target: { value: '5000000' },
    });
    expect(screen.getByRole('alert').textContent).toMatch(/above the maximum/);
    expect(
      (screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
