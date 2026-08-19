import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The API client's failure handling. React Native's fetch has no default
 * timeout: a connection that is accepted and never answered leaves the
 * promise pending forever, with no rejection for a caller to react to —
 * which is how the contact importer's spinner ran indefinitely while
 * nothing was written server-side.
 *
 * api.ts reaches for Supabase, the auth store and env; all three are
 * mocked so the module loads under the plain Node runner.
 */

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token-1' } } }),
      refreshSession: async () => ({ data: { session: null } }),
    },
  },
}));

vi.mock('./auth-store', () => ({ signOut: async () => {} }));

vi.mock('./env', () => ({ ENV: { apiBaseUrl: 'https://api.test' } }));

/** Minimal stand-in for a fetch Response — the client reads url/status/ok/json. */
function response(init: { url?: string; status?: number; body?: unknown }) {
  const status = init.status ?? 200;
  return {
    url: init.url ?? '',
    status,
    ok: status >= 200 && status < 300,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

/** Never answers; rejects like a real abort once the signal fires — or
 *  straight away when it is handed a signal that already has. */
function stallingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener('abort', abort);
      })
  );
}

async function freshClient() {
  vi.resetModules();
  return import('./api');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiFetch timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('abandons a request that never answers', async () => {
    const fetchMock = stallingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch, isTimeout } = await freshClient();

    const pending = apiFetch('/api/contacts', { method: 'POST', body: '{}' }).catch(
      (err) => err
    );
    await vi.advanceTimersByTimeAsync(20_001);
    const err = await pending;

    expect(isTimeout(err)).toBe(true);
    expect((err as Error).message).toMatch(/did not respond/i);
  });

  it('reports a caller cancellation apart from a timeout', async () => {
    const fetchMock = stallingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch, isCancelled, isTimeout } = await freshClient();

    const controller = new AbortController();
    const pending = apiFetch('/api/contacts', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    }).catch((err) => err);

    // Cancelling before the request leaves the client — the case a
    // bulk import hits between items — must still register.
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const err = await pending;

    expect(isCancelled(err)).toBe(true);
    expect(isTimeout(err)).toBe(false);
  });

  it('leaves a request that answers in time alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ body: { id: 'contact-1' } }))
    );
    const { apiFetch } = await freshClient();

    await expect(apiFetch<{ id: string }>('/api/contacts')).resolves.toEqual({
      id: 'contact-1',
    });
  });
});

describe('apiFetch redirect handling', () => {
  it('does not replay a POST body when the origin moved', async () => {
    // The apex → www hop strips Authorization, so the client pins the
    // real origin. Re-sending the body would create the record twice if
    // the redirected hop already reached the server.
    const fetchMock = vi.fn(async () =>
      response({ url: 'https://www.api.test/api/contacts', status: 201, body: { id: 'c1' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await freshClient();

    await apiFetch('/api/contacts', { method: 'POST', body: '{}' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-issues a GET against the resolved origin', async () => {
    const fetchMock = vi.fn(async () =>
      response({ url: 'https://www.api.test/api/contacts', body: { ok: true } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch, apiBase } = await freshClient();

    await apiFetch('/api/contacts');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(apiBase()).toBe('https://www.api.test');
  });
});

  describe('journey event logging', () => {
  it('logs a personal WhatsApp journey event', async () => {
    const fetchMock = vi.fn(async () =>
      response({ body: { ok: true, duplicate: false, eventId: 'je-1' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { logPersonalWhatsAppJourneySend } = await freshClient();

    await logPersonalWhatsAppJourneySend({
      itemId: 'journey-item-1',
      message: 'Hi from journey',
      source: 'mobile',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = (fetchMock.mock.calls[0] ?? null) as unknown as [string, RequestInit] | undefined;
    const init = (firstCall?.[1] ?? ({} as RequestInit)) as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({
        item_id: 'journey-item-1',
        message: 'Hi from journey',
        source: 'mobile',
      })
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
  });

  it('propagates duplicate response from journey event logging', async () => {
    const fetchMock = vi.fn(async () =>
      response({ body: { ok: true, duplicate: true, eventId: null } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { logPersonalWhatsAppJourneySend } = await freshClient();

    const payload = await logPersonalWhatsAppJourneySend({
      itemId: 'journey-item-1',
      message: 'Hi from journey',
      source: 'mobile',
    });

    expect(payload).toEqual({ ok: true, duplicate: true, eventId: null });
  });
});
