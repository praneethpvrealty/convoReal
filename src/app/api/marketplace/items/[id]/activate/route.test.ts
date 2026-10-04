import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  readOnly: false,
  gateCalls: [] as string[],
  adminReads: 0,
}));

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async (min: string) => {
    state.gateCalls.push(min);
    if (state.readOnly) {
      throw Object.assign(new Error('Read-only members cannot make changes.'), {
        status: 403,
      });
    }
    return { accountId: 'acct-a', userId: 'user-a' };
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      state.adminReads += 1;
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: null, error: { message: 'none' } }),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/marketplace/razorpay', () => ({
  createRazorpayOrder: async () => ({ id: 'order-1' }),
}));

import { POST as activate } from './route';
import { POST as checkout } from '../checkout/route';

const params = { params: Promise.resolve({ id: 'item-1' }) };

beforeEach(() => {
  state.readOnly = false;
  state.gateCalls.length = 0;
  state.adminReads = 0;
});

describe.each([
  ['activate', activate],
  ['checkout', checkout],
])('POST /api/marketplace/items/[id]/%s', (_name, handler) => {
  it('refuses a read-only member before touching the item', async () => {
    state.readOnly = true;

    const res = await handler(
      new Request('http://x', { method: 'POST' }),
      params
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      'Read-only members cannot make changes.'
    );
    expect(state.adminReads).toBe(0);
  });

  it('gates on the agent write role', async () => {
    const res = await handler(
      new Request('http://x', { method: 'POST' }),
      params
    );

    expect(state.gateCalls).toEqual(['agent']);
    expect(res.status).toBe(404);
  });
});
