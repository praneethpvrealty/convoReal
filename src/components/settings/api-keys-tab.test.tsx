// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// Settings → API keys.
//
// The assertions that earn this file are the ones about the secret.
// A key is shown exactly once — only its SHA-256 hash is stored, so
// nothing can resurface it — which makes "the plaintext reached the
// screen, and the screen said so" a correctness property rather than a
// cosmetic one. The rest guard the two ways this panel could hand out
// more access than intended: defaulting to a write-capable key, or
// letting a non-admin reach the controls.
// ============================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiKeysTab } from '@/components/settings/api-keys-tab';

const auth = vi.hoisted(() => ({ canManageMembers: true, accountRole: 'admin' }));
const plan = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    canManageMembers: auth.canManageMembers,
    accountRole: auth.accountRole,
    profileLoading: false,
  }),
}));

vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({
    isAllowed: () => plan.allowed,
    isLoading: false,
    upgradeUrl: '/settings?tab=billing',
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LIVE_KEY = {
  id: 'k1',
  name: 'Claude Desktop',
  key_prefix: 'cvr_sk_abc123',
  scopes: ['read'],
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ApiKeysTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.canManageMembers = true;
  auth.accountRole = 'admin';
  plan.allowed = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ApiKeysTab', () => {
  it('lists existing keys by prefix, never by secret', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [LIVE_KEY] }), { status: 200 })),
    );

    renderPanel();

    expect(await screen.findByText('Claude Desktop')).toBeTruthy();
    expect(screen.getByText(/cvr_sk_abc123/)).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows the plaintext key once, and says it will not be shown again', async () => {
    const secret = 'cvr_sk_theOnlyTimeThisIsEverVisible';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ secret }), { status: 201 });
        }
        return new Response(JSON.stringify({ keys: [] }), { status: 200 });
      }),
    );

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByPlaceholderText('Claude Desktop'), {
      target: { value: 'n8n prod' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(await screen.findByText(secret)).toBeTruthy();
    // The warning has to be present at the moment the secret is, not
    // somewhere the user has already scrolled past.
    expect(screen.getByText(/only time it will be shown/i)).toBeTruthy();
  });

  it('creates a read-only key unless writes are explicitly enabled', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ secret: 'cvr_sk_x' }), { status: 201 });
      }
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByPlaceholderText('Claude Desktop'), {
      target: { value: 'read only' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string).scopes).toEqual(['read']);
    });
  });

  it('asks for confirmation before revoking, and names the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [LIVE_KEY] }), { status: 200 })),
    );

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /revoke/i }));

    expect(await screen.findByText(/Revoke “Claude Desktop”\?/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  });

  it('marks a revoked key rather than hiding it, so the record survives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...LIVE_KEY, revoked_at: '2026-08-05T00:00:00.000Z' }],
            }),
            { status: 200 },
          ),
      ),
    );

    renderPanel();

    expect(await screen.findByText('Revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^revoke$/i })).toBeNull();
  });

  it('reports an expired key as expired, not active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...LIVE_KEY, expires_at: '2020-01-01T00:00:00.000Z' }],
            }),
            { status: 200 },
          ),
      ),
    );

    renderPanel();

    expect(await screen.findByText('Expired')).toBeTruthy();
  });

  it('tells a workspace without API access why its keys are inert', async () => {
    plan.allowed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [LIVE_KEY] }), { status: 200 })),
    );

    renderPanel();

    expect(await screen.findByText(/API access is on the Agency plan/i)).toBeTruthy();
    // Still listed — an admin needs to see what exists in order to
    // revoke it, whatever the plan says. Awaited separately: the plan
    // banner renders from a hook and the list from a query, so the
    // banner appearing says nothing about the list having loaded.
    expect(await screen.findByText('Claude Desktop')).toBeTruthy();
  });

  it('shows nothing to a non-admin and does not even fetch the list', async () => {
    auth.canManageMembers = false;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ keys: [LIVE_KEY] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    expect(screen.getByText(/managed by workspace admins and owners/i)).toBeTruthy();
    expect(screen.queryByText('Claude Desktop')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of rendering an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'Failed to load API keys' }), { status: 500 }),
      ),
    );

    renderPanel();

    expect(await screen.findByText('Failed to load API keys')).toBeTruthy();
    expect(screen.queryByText(/No API keys yet/i)).toBeNull();
  });
});
