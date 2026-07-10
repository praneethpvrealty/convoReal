// ============================================================
// Server-side plan gates — call inside API route handlers.
//
// Usage:
//   const ctx = await requireRole('agent');
//   const gate = await checkPlanLimit(ctx, 'contacts');
//   if (!gate.allowed) {
//     return Response.json({ error: gate.reason, upgradeRequired: gate.upgradeRequired }, { status: 402 });
//   }
//
// Always enforce server-side. Never trust client-side plan checks
// for write operations.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountContext } from '@/lib/auth/account';
import type { GatedFeature, GateResult, Plan, PlanLimits } from './types';
import { PLAN_CONFIG, upgradeRequiredFor } from './plan-config';

/** Fetch the effective plan limits for an account from the view. */
export async function getPlanLimits(ctx: AccountContext): Promise<PlanLimits> {
  const { data, error } = await ctx.supabase
    .from('account_plan_limits')
    .select('*')
    .eq('account_id', ctx.accountId)
    .single();

  if (error || !data) {
    // Default to Starter if the view row is missing (shouldn't happen)
    return {
      account_id: ctx.accountId,
      plan: 'starter',
      status: 'active',
      billing_cycle: null,
      current_period_end: null,
      pending_plan: null,
      pending_plan_effective_at: null,
      max_users: 1,
      max_contacts: 50,
      max_properties: 10,
      max_broadcasts_per_month: 0,
      has_ai: false,
      has_teams: false,
      has_multi_number: false,
      has_api_access: false,
      has_branded_showcase: false,
      has_custom_subdomain: false,
    };
  }
  return data as PlanLimits;
}

/**
 * Check whether this account is allowed to perform a gated action.
 *
 * For count-based limits (contacts, properties, users) the current count
 * is read inside this function so the caller doesn't need to pass it.
 */
export async function checkPlanLimit(
  ctx: AccountContext,
  feature: GatedFeature,
): Promise<GateResult> {
  const limits = await getPlanLimits(ctx);
  const plan = limits.plan as Plan;

  switch (feature) {
    case 'ai': {
      if (!limits.has_ai) {
        return {
          allowed: false,
          reason: 'AI features require Solo Pro or higher',
          upgradeRequired: upgradeRequiredFor('ai', plan) ?? 'solo_pro',
        };
      }
      return { allowed: true };
    }

    case 'teams': {
      if (!limits.has_teams) {
        return {
          allowed: false,
          reason: 'Team features require the Team plan or higher',
          upgradeRequired: upgradeRequiredFor('teams', plan) ?? 'team',
        };
      }
      return { allowed: true };
    }

    case 'multi_number': {
      if (!limits.has_multi_number) {
        return {
          allowed: false,
          reason: 'Multi-number WhatsApp is available on the Agency plan',
          upgradeRequired: 'agency',
        };
      }
      return { allowed: true };
    }

    case 'api_access': {
      if (!limits.has_api_access) {
        return {
          allowed: false,
          reason: 'API access requires the Agency plan',
          upgradeRequired: 'agency',
        };
      }
      return { allowed: true };
    }

    case 'branded_showcase': {
      if (!limits.has_branded_showcase) {
        return {
          allowed: false,
          reason: 'Branded showcase requires Solo Pro or higher',
          upgradeRequired: upgradeRequiredFor('branded_showcase', plan) ?? 'solo_pro',
        };
      }
      return { allowed: true };
    }

    case 'meta_ads': {
      // Meta Ads (Click-to-WhatsApp campaigns) is a paid-plan feature.
      // Reuses the same underlying "paid plan" flag as AI (has_ai =
      // plan is not Starter) — no separate DB column needed — with an
      // ads-specific message.
      if (!limits.has_ai) {
        return {
          allowed: false,
          reason: 'Meta Ads requires Solo Pro or higher',
          upgradeRequired: upgradeRequiredFor('ai', plan) ?? 'solo_pro',
        };
      }
      return { allowed: true };
    }

    case 'contacts': {
      const limit = limits.max_contacts;
      if (limit >= 999999) return { allowed: true };

      const { count, error } = await ctx.supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId);

      if (error) return { allowed: true }; // fail open for counts

      const current = count ?? 0;
      if (current >= limit) {
        return {
          allowed: false,
          currentCount: current,
          limit,
          reason: `You've reached the ${limit} contact limit on the ${PLAN_CONFIG[plan].name} plan`,
          upgradeRequired: upgradeRequiredFor('contacts', plan) ?? 'solo_pro',
        };
      }
      return { allowed: true, currentCount: current, limit };
    }

    case 'properties': {
      const limit = limits.max_properties;
      if (limit >= 999999) return { allowed: true };

      const { count, error } = await ctx.supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId);

      if (error) return { allowed: true };

      const current = count ?? 0;
      if (current >= limit) {
        return {
          allowed: false,
          currentCount: current,
          limit,
          reason: `You've reached the ${limit} property limit on the ${PLAN_CONFIG[plan].name} plan`,
          upgradeRequired: upgradeRequiredFor('properties', plan) ?? 'solo_pro',
        };
      }
      return { allowed: true, currentCount: current, limit };
    }

    case 'users': {
      const limit = limits.max_users;
      if (limit >= 999999) return { allowed: true };

      const { count, error } = await ctx.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId);

      if (error) return { allowed: true };

      const current = count ?? 0;
      if (current >= limit) {
        return {
          allowed: false,
          currentCount: current,
          limit,
          reason: `You've reached the ${limit} user limit on the ${PLAN_CONFIG[plan].name} plan`,
          upgradeRequired: upgradeRequiredFor('teams', plan) ?? 'team',
        };
      }
      return { allowed: true, currentCount: current, limit };
    }

    case 'broadcasts': {
      if (limits.max_broadcasts_per_month === 0) {
        return {
          allowed: false,
          reason: 'Broadcasts require Solo Pro or higher',
          upgradeRequired: upgradeRequiredFor('broadcasts', plan) ?? 'solo_pro',
        };
      }
      const limit = limits.max_broadcasts_per_month;
      if (limit >= 999999) return { allowed: true };

      // Count broadcast recipients sent this calendar month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count, error } = await ctx.supabase
        .from('broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .gte('created_at', startOfMonth.toISOString());

      if (error) return { allowed: true };

      const current = count ?? 0;
      if (current >= limit) {
        return {
          allowed: false,
          currentCount: current,
          limit,
          reason: `You've reached the ${limit} broadcast limit this month on the ${PLAN_CONFIG[plan].name} plan`,
          upgradeRequired: upgradeRequiredFor('broadcasts', plan) ?? 'team',
        };
      }
      return { allowed: true, currentCount: current, limit };
    }
  }
}

/**
 * Property-limit check for callers that don't have an `AccountContext`
 * (webhook/background workers running under the service-role key —
 * the WhatsApp "List My Property" intake, for one). Mirrors the
 * 'properties' case of `checkPlanLimit` exactly, just parameterized on
 * a raw client + accountId instead of a request-scoped ctx.
 */
export async function checkAccountPropertyLimit(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ limitReached: boolean; limit: number; currentCount: number }> {
  const { data: limits } = await supabase
    .from('account_plan_limits')
    .select('max_properties')
    .eq('account_id', accountId)
    .maybeSingle();

  const limit = (limits as { max_properties: number } | null)?.max_properties ?? 10;
  if (limit >= 999999) return { limitReached: false, limit, currentCount: 0 };

  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);

  const currentCount = count ?? 0;
  return { limitReached: currentCount >= limit, limit, currentCount };
}

/** Convenience: throw a 402 Response when a gate fails. */
export function gateResponse(gate: GateResult): Response {
  return Response.json(
    {
      error: gate.reason ?? 'Plan limit reached',
      upgradeRequired: gate.upgradeRequired,
      currentCount: gate.currentCount,
      limit: gate.limit,
    },
    { status: 402 },
  );
}
