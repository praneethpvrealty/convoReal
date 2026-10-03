// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { ActiveUsers } from './active-users';

const NOW = new Date().toISOString();

const tables = vi.hoisted(() => ({
  profiles: [] as unknown[],
  contacts: [] as unknown[],
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'viewer' }, accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: 'profiles' | 'contacts') => {
      const result = { data: tables[table], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve(result),
      };
      return chain;
    },
  }),
}));

vi.mock('@/components/contacts/name-tag-badge', () => ({
  NameTagBadge: () => null,
}));

afterEach(cleanup);

describe('ActiveUsers', () => {
  it('splits team members and clients under their own sub-headings', async () => {
    tables.profiles = [
      {
        id: 'p1',
        user_id: 'u1',
        full_name: 'Ravi Agent',
        account_role: 'agent',
        updated_at: NOW,
      },
    ];
    tables.contacts = [
      {
        id: 'c1',
        name: 'Meera Buyer',
        name_tag: null,
        phone: '+919800000000',
        classification: 'Buyer',
        requirements: null,
        updated_at: NOW,
      },
    ];

    render(<ActiveUsers />);

    const team = (await screen.findByRole('heading', { name: 'Team' }))
      .parentElement!;
    const clients = screen.getByRole('heading', {
      name: 'Clients',
    }).parentElement!;

    expect(within(team).getByText('Ravi Agent')).toBeTruthy();
    expect(within(team).queryByText('Meera Buyer')).toBeNull();
    expect(within(clients).getByText('Meera Buyer')).toBeTruthy();
    expect(within(clients).getAllByText('Online')).toHaveLength(1);
  });

  it('omits a group that has nobody in it', async () => {
    tables.profiles = [];
    tables.contacts = [
      {
        id: 'c1',
        name: 'Meera Buyer',
        name_tag: null,
        phone: '+919800000000',
        classification: 'Buyer',
        requirements: null,
        updated_at: NOW,
      },
    ];

    render(<ActiveUsers />);

    expect(
      await screen.findByRole('heading', { name: 'Clients' })
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Team' })).toBeNull();
  });
});
