// ============================================================
// Server half of the subscription-extension step-up: the pieces that
// touch Supabase and WhatsApp, kept out of admin-extension.ts so that
// module stays pure and unit-testable.
//
// Shared by all three routes under
// src/app/api/admin/subscription-extensions/ — issuing a challenge,
// consuming it, and the super-admin guard they all sit behind.
// ============================================================

import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { createClient } from '@/lib/supabase/server';
import { sendAdminOtpCode } from '@/lib/whatsapp/admin-otp-sender';
import { hashOtpCode, OTP_TTL_MS } from './admin-otp';
import {
  evaluateExtensionChallenge,
  EXTENSION_FAILURE_STATUS,
  type ExtensionChallengeRow,
  type ExtensionFailureReason,
} from './admin-extension';

export type ExtensionAction = 'extension_grant' | 'extension_revoke';

interface SuperAdminOk {
  authorized: true;
  userId: string;
  email: string | null;
  phone: string | null;
}
interface SuperAdminDenied {
  authorized: false;
  status: number;
  error: string;
}

/**
 * Super-admin guard. Mirrors checkSuperAdmin in the plan-override
 * routes, and additionally returns the acting admin's own phone and
 * email — the phone is the step-up channel, the email is snapshotted
 * onto every audit row so the trail survives the admin's auth user
 * being deleted.
 */
export async function requireSuperAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: SupabaseClient
): Promise<SuperAdminOk | SuperAdminDenied> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if ((profile as { role?: string } | null)?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden' };
  }

  // Read the phone through the service-role client: profiles RLS scopes
  // the SSR client to the admin's own account, which is where their row
  // lives, but the admin client makes this independent of that.
  const { data: adminProfile } = await admin
    .from('profiles')
    .select('phone, email')
    .eq('user_id', user.id)
    .maybeSingle();

  const row = adminProfile as {
    phone?: string | null;
    email?: string | null;
  } | null;

  return {
    authorized: true,
    userId: user.id,
    email: row?.email ?? user.email ?? null,
    phone: row?.phone ?? null,
  };
}

export type IssueResult =
  | { ok: true; challengeId: string; expiresAt: string }
  | { ok: false; status: number; error: string };

/**
 * Mints a challenge bound to `payloadHash` and WhatsApps the code to
 * the acting admin's own number. The code is never returned, logged, or
 * persisted in plaintext — only its SHA-256.
 */
export async function issueExtensionChallenge(args: {
  admin: SupabaseClient;
  adminUserId: string;
  adminPhone: string | null;
  action: ExtensionAction;
  payloadHash: string;
  accountId: string | null;
}): Promise<IssueResult> {
  if (!args.adminPhone) {
    return {
      ok: false,
      status: 400,
      error:
        'Your admin profile has no phone number on file — cannot deliver a WhatsApp OTP.',
    };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: challenge, error: insertError } = await (args.admin as any)
    .from('admin_plan_otp_challenges')
    .insert({
      admin_user_id: args.adminUserId,
      // Set only for single-account grants — a bulk grant's subject is
      // the account set inside payload_hash, not one column.
      account_id: args.accountId,
      action: args.action,
      payload_hash: args.payloadHash,
      code_hash: hashOtpCode(code),
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertError || !challenge) {
    console.error(
      '[admin/subscription-extensions] challenge insert failed:',
      insertError
    );
    return {
      ok: false,
      status: 500,
      error: 'Failed to create verification challenge',
    };
  }

  const sent = await sendAdminOtpCode(args.admin, {
    toPhone: args.adminPhone,
    code,
  });
  if (!sent) {
    return {
      ok: false,
      status: 502,
      error:
        'Failed to send verification code via WhatsApp. Check the platform WhatsApp sender configuration.',
    };
  }

  return { ok: true, challengeId: (challenge as { id: string }).id, expiresAt };
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; status: number; reason: ExtensionFailureReason };

/**
 * Verifies a submitted code against its challenge and, on success,
 * marks the challenge used BEFORE the caller mutates any billing state,
 * so a retry with the same code can never apply the change twice.
 */
export async function consumeExtensionChallenge(args: {
  admin: SupabaseClient;
  challengeId: string;
  code: string;
  adminUserId: string;
  action: ExtensionAction;
  payloadHash: string;
}): Promise<ConsumeResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (args.admin as any)
    .from('admin_plan_otp_challenges')
    .select(
      'id, admin_user_id, action, payload_hash, code_hash, attempts, expires_at, used_at'
    )
    .eq('id', args.challengeId)
    .maybeSingle();

  const challenge = row as ExtensionChallengeRow | null;

  const result = evaluateExtensionChallenge(challenge, {
    code: args.code,
    nowMs: Date.now(),
    adminUserId: args.adminUserId,
    action: args.action,
    payloadHash: args.payloadHash,
  });

  if (!result.ok) {
    if (result.incrementAttempts && challenge) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (args.admin as any)
        .from('admin_plan_otp_challenges')
        .update({ attempts: challenge.attempts + 1 })
        .eq('id', args.challengeId);
    }
    return {
      ok: false,
      reason: result.reason,
      status: EXTENSION_FAILURE_STATUS[result.reason] ?? 401,
    };
  }

  // Single-use, consumed before anything is written. `used_at IS NULL`
  // makes this a compare-and-set: two requests racing the same code can
  // only have one of them claim it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed } = await (args.admin as any)
    .from('admin_plan_otp_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', args.challengeId)
    .is('used_at', null)
    .select('id');

  if (!claimed || (claimed as unknown[]).length === 0) {
    return { ok: false, reason: 'used', status: EXTENSION_FAILURE_STATUS.used };
  }

  return { ok: true };
}
