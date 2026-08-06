// ============================================================
// Admin WhatsApp OTP step-up — the shared, Supabase-free core.
//
// Certain super-admin actions bypass the payment gateway and change an
// account's billing entitlement directly (plan override, subscription
// extension). A valid session is not enough for those: each one is
// gated by a 6-digit code delivered to the ACTING ADMIN's own WhatsApp
// number, proving live control of that channel.
//
// This module owns the parts that are identical across every such
// action — lifecycle (single-use, expiring, attempt-capped), the acting
// admin binding, and the constant-time code comparison. Callers supply
// the action-specific bindings that make a code non-replayable against
// a different change (see admin-plan-override.ts and
// admin-extension.ts).
//
// Everything here is pure: routes fetch the challenge row and pass it
// in, this decides whether it is valid, and the caller persists the
// attempt increment / used_at marker from the result.
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { hashInviteToken } from '@/lib/auth/invitations';

/** Max verification attempts per challenge before it's permanently rejected. */
export const MAX_OTP_ATTEMPTS = 5;
/** Challenge lifetime — must match the copy sent over WhatsApp. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** SHA-256 hex digest of a 6-digit OTP code. Same primitive as
 *  hashInviteToken (src/lib/auth/invitations.ts) — reused rather than
 *  duplicated, aliased here for readability at call sites. */
export const hashOtpCode = hashInviteToken;

/** The columns every challenge row has, whatever action it authorizes. */
export interface OtpChallengeCore {
  id: string;
  admin_user_id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
}

export interface OtpCoreInput {
  code: string;
  nowMs: number;
  adminUserId: string;
}

export type CoreFailureReason =
  | 'not_found'
  | 'used'
  | 'expired'
  | 'too_many_attempts'
  | 'admin_mismatch'
  | 'wrong_code';

export type OtpResult<R extends string> =
  | { ok: true }
  | { ok: false; reason: R; incrementAttempts: boolean };

/** An action-specific check that must hold before the code is compared.
 *  `matches: false` rejects with `reason` and burns an attempt. */
export interface OtpBinding<R extends string> {
  reason: R;
  matches: boolean;
}

export function otpHashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  // Length check first: timingSafeEqual throws on mismatched lengths,
  // and the check itself leaks nothing sensitive (both are SHA-256 hex
  // so a length mismatch only ever means "not a real hash").
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validates a submitted OTP against its stored challenge.
 *
 * Order matters and is deliberate:
 *   1. Lifecycle (missing / used / expired / attempt cap) — these cost
 *      no attempt, since none of them is a guess.
 *   2. Acting-admin binding, then the caller's own bindings — checked
 *      BEFORE the code comparison so a challenge issued for one change
 *      can never authorize a different one, even with the right code.
 *   3. The code itself, compared in constant time.
 */
export function evaluateOtpChallenge<R extends string>(
  challenge: OtpChallengeCore | null,
  input: OtpCoreInput,
  bindings: readonly OtpBinding<R>[] = []
): OtpResult<CoreFailureReason | R> {
  if (!challenge)
    return { ok: false, reason: 'not_found', incrementAttempts: false };
  if (challenge.used_at)
    return { ok: false, reason: 'used', incrementAttempts: false };
  if (new Date(challenge.expires_at).getTime() <= input.nowMs) {
    return { ok: false, reason: 'expired', incrementAttempts: false };
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', incrementAttempts: false };
  }
  if (challenge.admin_user_id !== input.adminUserId) {
    return { ok: false, reason: 'admin_mismatch', incrementAttempts: true };
  }
  for (const binding of bindings) {
    if (!binding.matches) {
      return { ok: false, reason: binding.reason, incrementAttempts: true };
    }
  }
  if (!otpHashesEqual(hashOtpCode(input.code), challenge.code_hash)) {
    return { ok: false, reason: 'wrong_code', incrementAttempts: true };
  }
  return { ok: true };
}

/** HTTP status for each shared failure reason. Action-specific modules
 *  spread this and add their own binding reasons. */
export const CORE_FAILURE_STATUS: Record<CoreFailureReason, number> = {
  not_found: 404,
  used: 410,
  expired: 410,
  too_many_attempts: 429,
  admin_mismatch: 401,
  wrong_code: 401,
};
