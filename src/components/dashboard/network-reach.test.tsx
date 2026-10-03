// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { NetworkReach } from './network-reach';

function reach(title: string, counts: Partial<Record<string, number>> = {}) {
  return {
    property_id: title,
    title,
    directBuyers: 0,
    newDirectBuyers: 0,
    indirectBuyers: 0,
    newIndirectBuyers: 0,
    agentsReached: 0,
    ...counts,
  };
}

function stubAccounts(accounts: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accounts } }),
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NetworkReach', () => {
  it('hides rows where every count is zero', async () => {
    stubAccounts([
      {
        accountName: 'Partner Realty',
        properties: [
          reach('Reached Villa', { directBuyers: 2 }),
          reach('Silent Plot'),
        ],
      },
      { accountName: 'Quiet Partner', properties: [reach('Quiet Flat')] },
    ]);
    render(<NetworkReach />);

    expect(await screen.findByText('Reached Villa')).toBeTruthy();
    expect(screen.queryByText('Silent Plot')).toBeNull();
    expect(screen.queryByText('Quiet Partner')).toBeNull();
    expect(screen.queryByText('No partner reach yet')).toBeNull();
  });

  it('shows a one-line empty state when no row has reach', async () => {
    stubAccounts([
      { accountName: 'Partner Realty', properties: [reach('Silent Plot')] },
    ]);
    render(<NetworkReach />);

    expect(await screen.findByText('No partner reach yet')).toBeTruthy();
    expect(screen.queryByText('Silent Plot')).toBeNull();
  });

  it('renders nothing for an agent with no partner accounts', async () => {
    stubAccounts([]);
    const { container } = render(<NetworkReach />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
