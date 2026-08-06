// ============================================================
// Admin plan-override — pure, Supabase-free security logic.
//
// A super-admin can upgrade/downgrade any account's plan without
// going through Razorpay/Stripe (comps, offline payments, disputes,
// correcting a wrong tier). Because this bypasses payment entirely,
// it's gated by a WhatsApp OTP step-up (see
// src/app/api/admin/organizations/[id]/plan/{challenge,}/route.ts and
// supabase/migrations/115_admin_plan_otp_challenges.sql) — proving
// live control of the acting admin's own WhatsApp number, not just a
// valid session.
//
// Everything here is pure and unit-testable without a database: the
// routes fetch the challenge row and pass it in; this module decides
// whether it's valid. The lifecycle/admin/code half of that decision is
// shared with every other OTP-gated admin action and lives in
// ./admin-otp; what remains here is the plan-specific binding.
// ============================================================

import {
  evaluateOtpChallenge,
  hashOtpCode,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  type CoreFailureReason,
} from "./admin-otp";
import { PLAN_ORDER, isUpgrade as isUpgradePlan } from "./plan-config";
import type { Plan } from "./types";

export { hashOtpCode, MAX_OTP_ATTEMPTS, OTP_TTL_MS };

export const PLAN_VALUES: readonly Plan[] = PLAN_ORDER;

export function isValidPlan(value: string): value is Plan {
  return (PLAN_ORDER as readonly string[]).includes(value);
}

export interface OtpChallengeRow {
  id: string;
  admin_user_id: string;
  account_id: string;
  from_plan: string;
  to_plan: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

export interface ChallengeCheckInput {
  code: string;
  nowMs: number;
  adminUserId: string;
  accountId: string;
  plan: string;
}

export type ChallengeFailureReason =
  | CoreFailureReason
  | "account_mismatch"
  | "plan_mismatch";

export type ChallengeResult =
  | { ok: true }
  | { ok: false; reason: ChallengeFailureReason; incrementAttempts: boolean };

/**
 * Validates a submitted OTP against its stored challenge. Pure and
 * side-effect-free — the caller persists the attempt increment /
 * used_at marker based on the returned result.
 *
 * The account/plan bindings are handed to the shared evaluator, which
 * checks them before the code comparison so a challenge issued for one
 * change can never authorize a different one, even with the right code.
 */
export function evaluateChallenge(
  challenge: OtpChallengeRow | null,
  input: ChallengeCheckInput,
): ChallengeResult {
  return evaluateOtpChallenge(challenge, input, [
    { reason: "account_mismatch" as const, matches: challenge?.account_id === input.accountId },
    { reason: "plan_mismatch" as const, matches: challenge?.to_plan === input.plan },
  ]);
}

/** True when `toPlan` ranks higher than `fromPlan`. Invalid plan
 *  strings never count as an upgrade (fail closed). */
export function isUpgradeDirection(fromPlan: string, toPlan: string): boolean {
  if (!isValidPlan(fromPlan) || !isValidPlan(toPlan)) return false;
  return isUpgradePlan(fromPlan, toPlan);
}

/**
 * Whether an admin-applied plan change should re-grant the target
 * plan's monthly AI-credit allowance — mirrors the self-serve upgrade
 * route (src/app/api/billing/upgrade/route.ts), which resets the
 * monthly bucket immediately on upgrade.
 *
 * Downgrades deliberately return false: the existing balance is
 * preserved until the next natural billing cycle rather than being
 * reset to the lower plan's allowance mid-cycle (confirmed decision).
 * 'starter' is never paid, so it never re-grants either.
 */
export function shouldRegrantCredits(fromPlan: string, toPlan: string): boolean {
  return isUpgradeDirection(fromPlan, toPlan) && toPlan !== "starter";
}
