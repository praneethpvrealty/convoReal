import { describe, expect, it } from 'vitest';

import { checkPlanLimit, getPlanLimits } from './gates';
import { PLAN_CONFIG } from './plan-config';
import type { AccountContext } from '@/lib/auth/account';

// Minimal chainable Supabase stub. The plan-limits lookup ends in
// `.single()`; the count queries (contacts/properties) await the builder
// returned by `.eq()` directly — so the builder is both thenable and
// carries `.single()`.
function makeCtx(opts: {
  planLimits?: { data: unknown; error: unknown };
  contacts?: { count: number | null; error: unknown };
  properties?: { count: number | null; error: unknown };
}): AccountContext {
  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        single: () =>
          Promise.resolve(
            opts.planLimits ?? { data: null, error: { message: 'no row' } }
          ),
        then: (resolve: (v: unknown) => unknown) => {
          const result =
            table === 'contacts'
              ? opts.contacts ?? { count: 0, error: null }
              : table === 'properties'
                ? opts.properties ?? { count: 0, error: null }
                : { data: null, error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
  return { supabase, accountId: 'acc-1', userId: 'user-1', role: 'owner' } as unknown as AccountContext;
}

// An explicit starter plan-limits row, used to test checkPlanLimit's
// boundary logic independently of the getPlanLimits fallback constant.
function starterRow(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acc-1',
    plan: 'starter',
    status: 'active',
    max_users: 1,
    max_contacts: 100,
    max_properties: 20,
    max_broadcasts_per_month: 0,
    has_ai: false,
    has_teams: false,
    ...overrides,
  };
}

describe('getPlanLimits fallback (view row missing)', () => {
  it('falls back to the enforced starter caps from migration 156', async () => {
    const limits = await getPlanLimits(makeCtx({ planLimits: { data: null, error: { message: 'no row' } } }));
    expect(limits.plan).toBe('starter');
    // These mirror the account_plan_limits view as last defined in
    // supabase/migrations/156_restore_starter_caps.sql. The fallback must
    // stay in lockstep with the DB view and PLAN_CONFIG.starter.
    expect(limits.max_contacts).toBe(150);
    expect(limits.max_properties).toBe(50);
    expect(limits.max_users).toBe(1);
    expect(limits.max_broadcasts_per_month).toBe(0);
    expect(limits.has_ai).toBe(false);
  });

  it('returns the view row unchanged when present', async () => {
    const row = { account_id: 'acc-1', plan: 'agency', max_contacts: 999999, has_ai: true };
    const limits = await getPlanLimits(makeCtx({ planLimits: { data: row, error: null } }));
    expect(limits.plan).toBe('agency');
    expect(limits.max_contacts).toBe(999999);
  });
});

describe('pricing config stays in sync with enforced caps', () => {
  // The pricing page (PLAN_CONFIG.starter) and the enforced fallback must
  // agree, or Starter users are promised limits the system won't grant.
  // This locks the two together — change one and this fails until the
  // other (and the DB view migration) is reconciled.
  it('PLAN_CONFIG.starter matches the enforced starter fallback', async () => {
    const enforced = await getPlanLimits(makeCtx({ planLimits: { data: null, error: { message: 'no row' } } }));
    expect(PLAN_CONFIG.starter.maxContacts).toBe(enforced.max_contacts);
    expect(PLAN_CONFIG.starter.maxProperties).toBe(enforced.max_properties);
    expect(PLAN_CONFIG.starter.maxUsers).toBe(enforced.max_users);
  });
});

describe('checkPlanLimit — contacts boundary', () => {
  it('allows when the current count is below the limit', async () => {
    const gate = await checkPlanLimit(
      makeCtx({ planLimits: { data: starterRow(), error: null }, contacts: { count: 99, error: null } }),
      'contacts'
    );
    expect(gate.allowed).toBe(true);
  });

  it('blocks at the limit (current >= limit)', async () => {
    const gate = await checkPlanLimit(
      makeCtx({ planLimits: { data: starterRow(), error: null }, contacts: { count: 100, error: null } }),
      'contacts'
    );
    expect(gate.allowed).toBe(false);
    expect(gate.limit).toBe(100);
  });

  it('fails OPEN when the count query errors (documented behavior)', async () => {
    const gate = await checkPlanLimit(
      makeCtx({ planLimits: { data: starterRow(), error: null }, contacts: { count: null, error: { message: 'db down' } } }),
      'contacts'
    );
    expect(gate.allowed).toBe(true);
  });
});

describe('checkPlanLimit — feature flags on starter fallback', () => {
  it('blocks AI on starter', async () => {
    const gate = await checkPlanLimit(makeCtx({}), 'ai');
    expect(gate.allowed).toBe(false);
    expect(gate.upgradeRequired).toBe('solo_pro');
  });

  it('gates meta_ads on the same flag as AI', async () => {
    const gate = await checkPlanLimit(makeCtx({}), 'meta_ads');
    expect(gate.allowed).toBe(false);
  });
});
