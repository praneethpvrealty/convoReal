// ============================================================
// Meta Ads OAuth `state` param — sign/verify.
//
// Facebook's OAuth dialog round-trips whatever `state` we send back to
// our callback verbatim, but doesn't protect it — a forged callback
// hitting our redirect URI with an arbitrary state must not be
// trusted. We HMAC-sign {accountId, nonce, ts} with META_ADS_APP_SECRET
// so the callback can verify the state wasn't tampered with, and pair
// it with a nonce also stored in an httpOnly cookie (set in the
// /oauth/start route) so a replayed/stolen state value from logs or a
// referrer header alone can't be replayed — the attacker would also
// need the cookie. `ts` bounds how long a state value is valid.
//
// Pure and synchronous so it's unit-testable without a request/response
// cycle; the routes just call sign()/verify().
// ============================================================

import crypto from 'crypto';

export interface OAuthStatePayload {
  accountId: string;
  nonce: string;
  ts: number; // ms epoch
}

const MAX_STATE_AGE_MS = 10 * 60 * 1000; // 10 minutes

function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/** Encodes + signs a state payload into the opaque string sent to Meta. */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64url');
  const signature = hmac(secret, encoded);
  return `${encoded}.${signature}`;
}

export type VerifyOAuthStateResult =
  | { valid: true; payload: OAuthStatePayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verifies a state string against the secret and (optionally) an
 * expected nonce read from the request's httpOnly cookie. Timing-safe
 * signature comparison; explicit expiry check independent of it.
 */
export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  expectedNonce?: string | null,
): VerifyOAuthStateResult {
  if (!state) return { valid: false, reason: 'malformed' };
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx <= 0) return { valid: false, reason: 'malformed' };

  const encoded = state.slice(0, dotIdx);
  const signature = state.slice(dotIdx + 1);
  const expectedSignature = hmac(secret, encoded);

  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (
    typeof payload.accountId !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.ts !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  if (Date.now() - payload.ts > MAX_STATE_AGE_MS) {
    return { valid: false, reason: 'expired' };
  }

  if (expectedNonce !== undefined && expectedNonce !== null && payload.nonce !== expectedNonce) {
    return { valid: false, reason: 'bad_signature' };
  }

  return { valid: true, payload };
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
