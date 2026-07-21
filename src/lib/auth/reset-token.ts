import crypto from 'crypto';

/**
 * Self-contained password-reset tokens: an HMAC-signed
 * `userId.expiresAt.signature` triple, base64url-encoded. No Supabase
 * redirect flow — the token travels as a plain query parameter and is
 * verified server-side when the user submits a new password.
 *
 * The signing secret is `SUPABASE_SERVICE_ROLE_KEY`, so a forged token
 * would let an attacker reset any account's password. Both halves of
 * the flow (request → confirm) share this module so the sign and verify
 * logic can never drift apart.
 */

/** Sign a token for `userId` that expires one hour from now. */
export function generateResetToken(userId: string, secret: string): string {
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

/**
 * Verify a reset token. Returns the `userId` if the token is
 * well-formed, unexpired, and correctly signed; otherwise `null`.
 * Never throws — malformed input resolves to `null`.
 */
export function verifyResetToken(token: string, secret: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;

    const [userId, expiresAtStr, providedSig] = parts;
    const expiresAt = Number(expiresAtStr);

    if (isNaN(expiresAt) || Date.now() > expiresAt) return null;

    const payload = `${userId}.${expiresAtStr}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Length guard first — timingSafeEqual throws on unequal lengths.
    if (
      providedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(
        Buffer.from(providedSig, 'hex'),
        Buffer.from(expectedSig, 'hex')
      )
    ) {
      return null;
    }

    return userId;
  } catch {
    return null;
  }
}
