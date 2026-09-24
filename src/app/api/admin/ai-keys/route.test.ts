import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  admin: true,
  inserted: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: String(err) },
      { status: (err as { status?: number }).status ?? 500 }
    ),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: async () => {
    if (!state.admin)
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    return { userId: 'admin-1' };
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'slow down' }, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserted = row;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'k1',
                label: row.label,
                key_hint: row.key_hint,
                scope: row.scope,
                priority: row.priority,
                enabled: true,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));

import { POST } from './route';

const KEY = 'AIzaSyExampleKeyMaterial_1234567890';

function post(body: unknown) {
  return POST(
    new Request('http://test/api/admin/ai-keys', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.admin = true;
  state.inserted = null;
});

describe('POST /api/admin/ai-keys', () => {
  it('[AIK-003] is closed to anyone but a platform admin', async () => {
    state.admin = false;
    const res = await post({ label: 'x y', key: KEY });
    expect(res.status).toBe(403);
    expect(state.inserted).toBeNull();
  });

  it('[AIK-003] stores the key encrypted and returns only a hint', async () => {
    const res = await post({ label: 'praneeku@gmail.com', key: KEY });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).data.key_hint).toBe('…7890');
    expect(state.inserted?.key_ciphertext).not.toContain(KEY);
    expect(String(state.inserted?.key_ciphertext).split(':')).toHaveLength(3);
  });

  it('answers 400 for a malformed key', async () => {
    const res = await post({ label: 'ok label', key: 'nope' });
    expect(res.status).toBe(400);
  });
});
