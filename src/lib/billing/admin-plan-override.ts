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
// whether it's valid.
// ============================================================

import { timingSafeEqual } from "node:crypto";
import { hashInviteToken } from "@/lib/auth/invitations";
import { PLAN_ORDER, isUpgrade as isUpgradePlan } from "./plan-config";
import type { Plan } from "./types";

export const PLAN_VALUES: readonly Plan[] = PLAN_ORDER;

export function isValidPlan(value: string): value is Plan {
  return (PLAN_ORDER as readonly string[]).includes(value);
}

/** Max verification attempts per challenge before it's permanently rejected. */
export const MAX_OTP_ATTEMPTS = 5;
/** Challenge lifetime — must match the copy sent over WhatsApp. */
export const OTP_TTL_MS = 10 * 60 * 1000;

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
  | "not_found"
  | "used"
  | "expired"
  | "too_many_attempts"
  | "admin_mismatch"
  | "account_mismatch"
  | "plan_mismatch"
  | "wrong_code";

export type ChallengeResult =
  | { ok: true }
  | { ok: false; reason: ChallengeFailureReason; incrementAttempts: boolean };

/** SHA-256 hex digest of a 6-digit OTP code. Same primitive as
 *  hashInviteToken (src/lib/auth/invitations.ts) — reused rather than
 *  duplicated, aliased here for readability at call sites. */
export const hashOtpCode = hashInviteToken;

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  // Length check first: timingSafeEqual throws on mismatched lengths,
  // and the check itself leaks nothing sensitive (both are SHA-256 hex
  // so a length mismatch only ever means "not a real hash").
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validates a submitted OTP against its stored challenge. Pure and
 * side-effect-free — the caller persists the attempt increment /
 * used_at marker based on the returned result.
 *
 * Binding checks (admin/account/plan) run before the code comparison
 * so a challenge issued for one change can never authorize a
 * different one, even with the correct code.
 */
export function evaluateChallenge(
  challenge: OtpChallengeRow | null,
  input: ChallengeCheckInput,
): ChallengeResult {
  if (!challenge) return { ok: false, reason: "not_found", incrementAttempts: false };
  if (challenge.used_at) return { ok: false, reason: "used", incrementAttempts: false };
  if (new Date(challenge.expires_at).getTime() <= input.nowMs) {
    return { ok: false, reason: "expired", incrementAttempts: false };
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts", incrementAttempts: false };
  }
  if (challenge.admin_user_id !== input.adminUserId) {
    return { ok: false, reason: "admin_mismatch", incrementAttempts: true };
  }
  if (challenge.account_id !== input.accountId) {
    return { ok: false, reason: "account_mismatch", incrementAttempts: true };
  }
  if (challenge.to_plan !== input.plan) {
    return { ok: false, reason: "plan_mismatch", incrementAttempts: true };
  }
  if (!hashesEqual(hashOtpCode(input.code), challenge.code_hash)) {
    return { ok: false, reason: "wrong_code", incrementAttempts: true };
  }
  return { ok: true };
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
