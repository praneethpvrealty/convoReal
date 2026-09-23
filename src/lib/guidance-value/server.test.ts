import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
  getCurrentAccount: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import type { SupabaseClient } from '@supabase/supabase-js';

import { findCandidateRates } from './server';

describe('findCandidateRates', () => {
  it('[GVL-002] never widens a district-scoped search to the whole state', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        calls.push(args);
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;

    const rates = await findCandidateRates(db, {
      district: 'Mysuru',
      village: 'Hosahalli',
    });

    expect(rates).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.p_district_pattern).toBe('(mysuru|mysore)');
    }
  });
});
