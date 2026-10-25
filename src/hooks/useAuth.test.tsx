// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  direct: null as null | (() => Promise<unknown>),
  directCalls: 0,
}));

vi.mock('@/lib/navigation', () => ({ reloadTo: vi.fn() }));

vi.mock('@/lib/supabase/client', () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => {
      state.directCalls += 1;
      return state.direct!();
    },
  };
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    from: () => query,
  };
  return { createClient: () => client };
});

const { AuthProvider, useAuth } = await import('./useAuth');

const apiBody = {
  data: {
    profile: {
      id: 'p-1',
      full_name: 'Asha',
      email: 'asha@example.com',
      phone: null,
      avatar_url: null,
      role: null,
      beta_features: [],
      account_id: 'acct-1',
      account_role: 'owner',
      org_role: 'org_manager',
      team_id: null,
      is_read_only: false,
      ui_languages: [],
      active_ui_language: null,
      showcase_style: null,
      showcase_3d_enabled: null,
    },
    account: { id: 'acct-1', name: 'Asha Realty', status: 'active' },
  },
};

function Probe() {
  const { profile, profileLoading, profileError, accountId } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(profileLoading)}</span>
      <span data-testid="error">{String(profileError)}</span>
      <span data-testid="name">{profile?.full_name ?? 'none'}</span>
      <span data-testid="account">{accountId ?? 'none'}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

const fetchMock = vi.fn();

describe('[ACC-008] AuthProvider profile fallback', () => {
  beforeEach(() => {
    state.directCalls = 0;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads the profile through the app when the browser cannot reach Supabase', async () => {
    state.direct = () => Promise.reject(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(apiBody), { status: 200 })
    );

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );
    expect(screen.getByTestId('error').textContent).toBe('false');
    expect(screen.getByTestId('name').textContent).toBe('Asha');
    expect(screen.getByTestId('account').textContent).toBe('acct-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    expect(state.directCalls).toBe(1);
  });

  it('never calls the fallback when the direct read works', async () => {
    state.direct = async () => ({
      data: { ...apiBody.data.profile, account: apiBody.data.account },
      error: null,
    });

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('name').textContent).toBe('Asha')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats "no profile row" from the fallback as no profile, not an error', async () => {
    state.direct = () => Promise.reject(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: null }), { status: 200 })
    );

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );
    expect(screen.getByTestId('error').textContent).toBe('false');
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('shows the error state only after both paths fail twice', async () => {
    state.direct = () => Promise.reject(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValue(new Response('{}', { status: 502 }));

    renderProbe();

    await waitFor(
      () => expect(screen.getByTestId('error').textContent).toBe('true'),
      { timeout: 5_000 }
    );
    expect(state.directCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});
