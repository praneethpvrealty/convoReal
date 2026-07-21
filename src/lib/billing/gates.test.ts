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

describe('getPlanLimits fallback (view row missing)', () => {
  it('falls back to the ENFORCED starter caps from migration 116', async () => {
    const limits = await getPlanLimits(makeCtx({ planLimits: { data: null, error: { message: 'no row' } } }));
    expect(limits.plan).toBe('starter');
    // These mirror the account_plan_limits view as last defined in
    // supabase/migrations/116_update_plan_caps.sql. The fallback must
    // stay in lockstep with the DB, not with the marketing config.
    expect(limits.max_contacts).toBe(50);
    expect(limits.max_properties).toBe(10);
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

describe('CHARACTERIZATION: pricing config diverges from enforced caps', () => {
  // NOT an assertion that the divergence is desirable — it documents a
  // real, live mismatch so any change to either side breaks this test and
  // forces a deliberate reconciliation. PLAN_CONFIG.starter is what the
  // pricing page advertises; the getPlanLimits fallback / DB view is what
  // is actually enforced. They currently disagree for the Starter tier.
  it('advertised starter caps exceed the enforced starter caps', async () => {
    const enforced = await getPlanLimits(makeCtx({ planLimits: { data: null, error: { message: 'no row' } } }));

    expect(PLAN_CONFIG.starter.maxContacts).toBe(150);
    expect(PLAN_CONFIG.starter.maxProperties).toBe(50);

    expect(enforced.max_contacts).toBe(50);
    expect(enforced.max_properties).toBe(10);

    expect(PLAN_CONFIG.starter.maxContacts).toBeGreaterThan(enforced.max_contacts);
    expect(PLAN_CONFIG.starter.maxProperties).toBeGreaterThan(enforced.max_properties);
  });
});

describe('checkPlanLimit — contacts boundary', () => {
  it('allows when the current count is below the limit', async () => {
    const gate = await checkPlanLimit(makeCtx({ contacts: { count: 49, error: null } }), 'contacts');
    expect(gate.allowed).toBe(true);
  });

  it('blocks at the limit (current >= limit)', async () => {
    const gate = await checkPlanLimit(makeCtx({ contacts: { count: 50, error: null } }), 'contacts');
    expect(gate.allowed).toBe(false);
    expect(gate.limit).toBe(50);
  });

  it('fails OPEN when the count query errors (documented behavior)', async () => {
    const gate = await checkPlanLimit(
      makeCtx({ contacts: { count: null, error: { message: 'db down' } } }),
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
