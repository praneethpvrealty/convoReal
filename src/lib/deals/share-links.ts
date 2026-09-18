import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Stakeholder links into a transaction.
 *
 * A link is a random token whose SHA-256 is stored — a database read
 * never yields a usable URL. It expires (30 days at most), can be
 * revoked, and every open is counted and logged. A sensitive link can
 * demand a one-time code: the code is hashed with the server key, is
 * checked at most five times, and a successful check returns a
 * short-lived unlock signed for that one link. Nothing here creates a
 * session or an auth.users row; the unlock is the whole of the
 * stakeholder's identity, and it dies with the link.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEAL_SHARE_TTL_CHOICES = [
  { key: '24h', label: '24 hours', ms: DAY_MS },
  { key: '7d', label: '7 days', ms: 7 * DAY_MS },
  { key: '30d', label: '30 days', ms: 30 * DAY_MS },
] as const;

export type DealShareTtlKey = (typeof DEAL_SHARE_TTL_CHOICES)[number]['key'];

export const DEFAULT_DEAL_SHARE_TTL_KEY: DealShareTtlKey = '7d';

export const DEAL_SHARE_MAX_TTL_MS = 30 * DAY_MS;

export function ttlMsForKey(key: unknown): number {
  const choice = DEAL_SHARE_TTL_CHOICES.find((c) => c.key === key);
  return choice ? choice.ms : 7 * DAY_MS;
}

export function hashDealShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function mintDealShareToken(
  ttlMs: number = 7 * DAY_MS,
  now: Date = new Date()
): { token: string; hash: string; prefix: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const bounded = Math.min(Math.max(ttlMs, 60_000), DEAL_SHARE_MAX_TTL_MS);
  return {
    token,
    hash: hashDealShareToken(token),
    prefix: token.slice(0, 8),
    expiresAt: new Date(now.getTime() + bounded).toISOString(),
  };
}

export interface DealShareLink {
  id: string;
  account_id: string;
  deal_id: string;
  stakeholder_id: string;
  token_hash: string;
  token_prefix: string;
  expires_at: string;
  revoked_at: string | null;
  otp_required: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DealShareLinkState = 'active' | 'expired' | 'revoked';

export function linkState(
  link: Pick<DealShareLink, 'expires_at' | 'revoked_at'>,
  now: Date = new Date()
): DealShareLinkState {
  if (link.revoked_at) return 'revoked';
  if (new Date(link.expires_at) <= now) return 'expired';
  return 'active';
}

export function isLinkLive(
  link: Pick<DealShareLink, 'expires_at' | 'revoked_at'>,
  now: Date = new Date()
): boolean {
  return linkState(link, now) === 'active';
}

/** The public URL. Token in the path, as invitations carry theirs. */
export function dealShareUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/deal/${token}`;
}

// ---- one-time codes ---------------------------------------------

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const UNLOCK_TTL_MS = 30 * 60 * 1000;

function serverKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  return Buffer.from(hex, 'hex');
}

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/** Keyed hash so a leaked table row cannot be brute-forced offline
 *  over a six-digit space. Bound to the link so a code for one link
 *  never verifies another. */
export function hashOtpCode(code: string, linkId: string): string {
  return createHmac('sha256', serverKey())
    .update(`otp:${linkId}:${code.trim()}`)
    .digest('hex');
}

export function otpMatches(
  code: string,
  linkId: string,
  storedHash: string
): boolean {
  const a = Buffer.from(hashOtpCode(code, linkId), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidOtpFormat(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code.trim())
  );
}

/** A signed, expiring proof that this link's OTP was passed. Carried
 *  by the client in a header; never stored server-side. */
export function signUnlock(
  linkId: string,
  now: Date = new Date()
): {
  unlock: string;
  expiresAt: string;
} {
  const exp = now.getTime() + UNLOCK_TTL_MS;
  const payload = `${linkId}.${exp}`;
  const sig = createHmac('sha256', serverKey())
    .update(`unlock:${payload}`)
    .digest('base64url');
  return {
    unlock: `${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyUnlock(
  unlock: string | null | undefined,
  linkId: string,
  now: Date = new Date()
): boolean {
  if (!unlock) return false;
  const parts = unlock.split('.');
  if (parts.length !== 3) return false;
  const [id, expText, sig] = parts;
  const exp = Number(expText);
  if (id !== linkId || !Number.isFinite(exp) || exp <= now.getTime())
    return false;
  const expected = createHmac('sha256', serverKey())
    .update(`unlock:${id}.${expText}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Never store or log a raw address. */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`ip:${ip}`).digest('hex').slice(0, 32);
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseShareLinkInput(
  raw: unknown
): ParseResult<{ stakeholderId: string; ttlMs: number; otpRequired: boolean }> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'stakeholder_id is required' };
  }
  const input = raw as Record<string, unknown>;
  const stakeholderId =
    typeof input.stakeholder_id === 'string' ? input.stakeholder_id.trim() : '';
  if (!stakeholderId) return { ok: false, error: 'stakeholder_id is required' };
  return {
    ok: true,
    value: {
      stakeholderId,
      ttlMs: ttlMsForKey(input.ttl),
      otpRequired: input.otp_required === true,
    },
  };
}
