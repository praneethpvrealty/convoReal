// ============================================================
// Admin subscription extensions — pure, Supabase-free logic.
//
// A super-admin can add paid days to accounts that lost service
// (outage, degraded performance, a billing mistake on our side). Like
// the plan override, this changes billing entitlement without any
// payment, so it carries the same WhatsApp OTP step-up — but the
// subject of an extension can be MANY accounts at once, which the
// plan-change binding (one account, one target plan) cannot express.
//
// Instead the whole request is canonicalized and hashed, and that hash
// is what the challenge is bound to. A code issued for "3 days to
// account X" cannot be replayed to apply "90 days to every account":
// the payload hash won't match, and the mismatch is checked before the
// code is ever compared.
//
// Routes: src/app/api/admin/subscription-extensions/{challenge,revoke,}/route.ts
// Storage: supabase/migrations/204_subscription_extensions.sql
// ============================================================

import { createHash } from 'node:crypto';
import {
  evaluateOtpChallenge,
  type CoreFailureReason,
  type OtpChallengeCore,
} from './admin-otp';

export const EXTENSION_REASONS = [
  'outage',
  'degraded_service',
  'billing_error',
  'onboarding_delay',
  'support_goodwill',
] as const;

export type ExtensionReason = (typeof EXTENSION_REASONS)[number];

export function isValidExtensionReason(
  value: unknown
): value is ExtensionReason {
  return (
    typeof value === 'string' &&
    (EXTENSION_REASONS as readonly string[]).includes(value)
  );
}

/** Ceiling per grant. Matches the CHECK on subscription_extensions.days:
 *  a single goodwill credit larger than a quarter is a commercial
 *  decision, not an operational one, and should not be one admin's
 *  click away. Stacking several grants is still possible and audited. */
export const MAX_EXTENSION_DAYS = 90;
/** Ceiling per bulk grant. An outage-wide credit is legitimate; a
 *  single request rewriting the entitlement of an unbounded number of
 *  accounts is not, and it also keeps the request body and the
 *  per-account audit insert to one sane batch. */
export const MAX_BULK_ACCOUNTS = 500;
export const MAX_NOTE_LENGTH = 500;
export const MAX_INCIDENT_REF_LENGTH = 64;
/** Customer-facing copy. Bounded well under the WhatsApp body limit so
 *  it still fits once the surrounding template text is added. */
export const MAX_CUSTOMER_MESSAGE_LENGTH = 600;

/** Incident refs are used to group and later revoke a whole grant, and
 *  are shown in the admin UI — keep them to a boring, greppable shape. */
const INCIDENT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExtensionRequest {
  accountIds: string[];
  days: number;
  reason: ExtensionReason;
  /** Internal operator shorthand. Never shown to the customer. */
  note: string | null;
  incidentRef: string | null;
  /** Optional override for the canned empathetic line the customer
   *  reads. Part of the payload hash, so the admin's OTP authorizes the
   *  exact wording that will be sent out in their name. */
  customerMessage: string | null;
  /** Whether to send the apology/goodwill notice. Default true — the
   *  point of a service credit is that the customer knows about it.
   *  Suppressing is for silent corrections of a mis-entered grant. */
  notify: boolean;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Validates and normalizes an extension request body.
 *
 * Normalization is part of the security contract, not a convenience:
 * the parsed value is what gets hashed into the challenge binding, so
 * the challenge and the apply step must agree byte-for-byte on it.
 * Duplicate account ids are collapsed here for the same reason — and
 * so one account can't be silently double-credited by a repeated id.
 */
export function parseExtensionRequest(
  body: unknown
): ParseResult<ExtensionRequest> {
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Request body is required' };
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.accountIds) || raw.accountIds.length === 0) {
    return { ok: false, error: 'accountIds must be a non-empty array' };
  }
  if (
    !raw.accountIds.every(
      (id) => typeof id === 'string' && UUID_PATTERN.test(id)
    )
  ) {
    return { ok: false, error: 'accountIds must all be account UUIDs' };
  }

  const accountIds = [...new Set(raw.accountIds as string[])].sort();
  if (accountIds.length > MAX_BULK_ACCOUNTS) {
    return {
      ok: false,
      error: `A single grant may cover at most ${MAX_BULK_ACCOUNTS} accounts`,
    };
  }

  if (typeof raw.days !== 'number' || !Number.isInteger(raw.days)) {
    return { ok: false, error: 'days must be a whole number' };
  }
  if (raw.days < 1 || raw.days > MAX_EXTENSION_DAYS) {
    return {
      ok: false,
      error: `days must be between 1 and ${MAX_EXTENSION_DAYS}`,
    };
  }

  if (!isValidExtensionReason(raw.reason)) {
    return {
      ok: false,
      error: `reason must be one of: ${EXTENSION_REASONS.join(', ')}`,
    };
  }

  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    };
  }

  const incidentRef =
    typeof raw.incidentRef === 'string' ? raw.incidentRef.trim() : '';
  if (incidentRef) {
    if (incidentRef.length > MAX_INCIDENT_REF_LENGTH) {
      return {
        ok: false,
        error: `incidentRef must be ${MAX_INCIDENT_REF_LENGTH} characters or fewer`,
      };
    }
    if (!INCIDENT_REF_PATTERN.test(incidentRef)) {
      return {
        ok: false,
        error:
          'incidentRef may contain only letters, numbers, dots, dashes and underscores',
      };
    }
  }

  // A grant touching more than one account is an incident-wide action;
  // requiring the ref means it can always be found and revoked as a unit.
  if (accountIds.length > 1 && !incidentRef) {
    return {
      ok: false,
      error: 'incidentRef is required when extending more than one account',
    };
  }

  const customerMessage =
    typeof raw.customerMessage === 'string' ? raw.customerMessage.trim() : '';
  if (customerMessage.length > MAX_CUSTOMER_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `customerMessage must be ${MAX_CUSTOMER_MESSAGE_LENGTH} characters or fewer`,
    };
  }

  return {
    ok: true,
    value: {
      accountIds,
      days: raw.days,
      reason: raw.reason,
      note: note || null,
      incidentRef: incidentRef || null,
      customerMessage: customerMessage || null,
      // Fail LOUD, not silent: anything other than an explicit false
      // notifies. A dropped field must not quietly turn into a credit
      // the customer never hears about.
      notify: raw.notify !== false,
    },
  };
}

/**
 * Canonical serialization of everything the admin is authorizing.
 * Field order is fixed and accountIds are already deduped+sorted by
 * parseExtensionRequest, so the same logical request always hashes the
 * same way regardless of how the client ordered its JSON.
 */
export function canonicalizeExtensionRequest(req: ExtensionRequest): string {
  return JSON.stringify([
    'extension_grant',
    req.accountIds,
    req.days,
    req.reason,
    req.note ?? '',
    req.incidentRef ?? '',
    req.customerMessage ?? '',
    req.notify,
  ]);
}

export function hashExtensionPayload(req: ExtensionRequest): string {
  return createHash('sha256')
    .update(canonicalizeExtensionRequest(req))
    .digest('hex');
}

export interface RevokeRequest {
  extensionIds: string[];
  incidentRef: string | null;
  reason: string | null;
}

export function parseRevokeRequest(body: unknown): ParseResult<RevokeRequest> {
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Request body is required' };
  const raw = body as Record<string, unknown>;

  const incidentRef =
    typeof raw.incidentRef === 'string' ? raw.incidentRef.trim() : '';
  const rawIds = Array.isArray(raw.extensionIds) ? raw.extensionIds : [];

  if (rawIds.length === 0 && !incidentRef) {
    return {
      ok: false,
      error: 'Provide extensionIds or an incidentRef to revoke',
    };
  }
  if (rawIds.length > 0 && incidentRef) {
    return {
      ok: false,
      error: 'Provide either extensionIds or incidentRef, not both',
    };
  }
  if (!rawIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
    return { ok: false, error: 'extensionIds must all be UUIDs' };
  }
  if (incidentRef && !INCIDENT_REF_PATTERN.test(incidentRef)) {
    return { ok: false, error: 'incidentRef is not a valid reference' };
  }

  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `reason must be ${MAX_NOTE_LENGTH} characters or fewer`,
    };
  }

  return {
    ok: true,
    value: {
      extensionIds: [...new Set(rawIds as string[])].sort(),
      incidentRef: incidentRef || null,
      reason: reason || null,
    },
  };
}

export function canonicalizeRevokeRequest(req: RevokeRequest): string {
  return JSON.stringify([
    'extension_revoke',
    req.extensionIds,
    req.incidentRef ?? '',
    req.reason ?? '',
  ]);
}

export function hashRevokePayload(req: RevokeRequest): string {
  return createHash('sha256')
    .update(canonicalizeRevokeRequest(req))
    .digest('hex');
}

export interface ExtensionChallengeRow extends OtpChallengeCore {
  action: string;
  payload_hash: string | null;
}

export type ExtensionFailureReason =
  | CoreFailureReason
  | 'action_mismatch'
  | 'payload_mismatch';

export type ExtensionChallengeResult =
  | { ok: true }
  | { ok: false; reason: ExtensionFailureReason; incrementAttempts: boolean };

/**
 * Validates an OTP against a challenge bound to an exact payload hash.
 *
 * `action` is checked as well as the hash so a code minted for a grant
 * can never be spent on a revoke (and vice versa) even in the
 * vanishingly unlikely event of a hash collision across the two
 * canonical forms — both already carry their action as their first
 * element, so this is belt and braces.
 */
export function evaluateExtensionChallenge(
  challenge: ExtensionChallengeRow | null,
  input: {
    code: string;
    nowMs: number;
    adminUserId: string;
    action: 'extension_grant' | 'extension_revoke';
    payloadHash: string;
  }
): ExtensionChallengeResult {
  return evaluateOtpChallenge(challenge, input, [
    {
      reason: 'action_mismatch' as const,
      matches: challenge?.action === input.action,
    },
    {
      reason: 'payload_mismatch' as const,
      matches:
        typeof challenge?.payload_hash === 'string' &&
        challenge.payload_hash.length > 0 &&
        challenge.payload_hash === input.payloadHash,
    },
  ]);
}

/**
 * The absolute deadline a grant of `days` buys.
 *
 * Anchored on whichever is later, the current period end or now: an
 * account whose period has already lapsed gets `days` of usable service
 * from today rather than `days` added to a date in the past, which
 * would credit them nothing. Accounts with no period at all (starter,
 * or never charged) are treated the same way.
 */
export function computeExtendedUntil(
  currentPeriodEnd: string | null | undefined,
  days: number,
  nowMs: number
): string {
  const periodEndMs = currentPeriodEnd
    ? new Date(currentPeriodEnd).getTime()
    : Number.NaN;
  const anchor = Number.isFinite(periodEndMs)
    ? Math.max(periodEndMs, nowMs)
    : nowMs;
  return new Date(anchor + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * What the account's access actually runs to once live credit is
 * layered on the gateway's own period end. Mirrors the
 * GREATEST(...) in the account_plan_limits view so the API can preview
 * a grant before it is written.
 */
export function effectivePeriodEnd(
  currentPeriodEnd: string | null | undefined,
  extendedUntil: string | null | undefined
): string | null {
  const candidates = [currentPeriodEnd, extendedUntil]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates)).toISOString();
}

export const EXTENSION_FAILURE_STATUS: Record<ExtensionFailureReason, number> =
  {
    not_found: 404,
    used: 410,
    expired: 410,
    too_many_attempts: 429,
    admin_mismatch: 401,
    wrong_code: 401,
    action_mismatch: 401,
    payload_mismatch: 401,
  };
