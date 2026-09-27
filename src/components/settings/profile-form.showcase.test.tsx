// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const updates: Array<Record<string, unknown>> = [];
let profile: Record<string, unknown>;

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', created_at: '2026-01-01T00:00:00Z' },
    profile,
    refreshProfile: vi.fn(),
  }),
}));

vi.mock('@/components/auth/whatsapp-phone-verify', () => ({
  WhatsappPhoneVerify: () => null,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'showcase_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    showcase_style: 'deal-floor',
                    showcase_3d_enabled: false,
                  },
                }),
            }),
          }),
        };
      }
      return {
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: () => ({
              select: () =>
                Promise.resolve({ data: [{ user_id: 'user-1' }], error: null }),
            }),
          };
        },
      };
    },
    auth: { updateUser: vi.fn() },
    storage: { from: vi.fn() },
  }),
}));

import { ProfileForm } from '@/components/settings/profile-form';

function renderForm(overrides: Record<string, unknown>) {
  profile = {
    id: 'profile-1',
    user_id: 'user-1',
    full_name: 'New Agent',
    email: 'agent@example.com',
    phone: null,
    avatar_url: null,
    account_id: 'acct-1',
    showcase_style: null,
    showcase_3d_enabled: null,
    ...overrides,
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProfileForm />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  updates.length = 0;
});

describe('personal showcase design [PRP-021]', () => {
  it('shows a new agent following the company design and keeps it unset on save', async () => {
    renderForm({});
    expect(
      await screen.findByText(/Following the company design \(Deal Floor\)/)
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /Deal Floor/ })
          .getAttribute('aria-pressed')
      ).toBe('true')
    );

    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: 'New Agent Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      full_name: 'New Agent Renamed',
      showcase_style: null,
      showcase_3d_enabled: null,
    });
  });

  it('lets an agent with their own design go back to the company design', async () => {
    renderForm({ showcase_style: 'editorial', showcase_3d_enabled: true });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Use the company design instead',
      })
    );
    expect(
      await screen.findByText(/Following the company design/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      showcase_style: null,
      showcase_3d_enabled: null,
    });
  });
});
