import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

import { generateResetToken, verifyResetToken } from './reset-token';

const SECRET = 'test-service-role-key';
const USER = 'user-abc-123';

describe('generateResetToken / verifyResetToken round-trip', () => {
  it('a freshly signed token verifies back to its userId', () => {
    const token = generateResetToken(USER, SECRET);
    expect(verifyResetToken(token, SECRET)).toBe(USER);
  });

  it('encodes userId, expiry, and signature as a base64url triple', () => {
    const token = generateResetToken(USER, SECRET);
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(USER);
    expect(Number(parts[1])).toBeGreaterThan(Date.now());
  });
});

describe('verifyResetToken — signature enforcement', () => {
  it('rejects a token signed with a different secret', () => {
    const token = generateResetToken(USER, SECRET);
    expect(verifyResetToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a token whose payload was tampered (userId swapped)', () => {
    const token = generateResetToken(USER, SECRET);
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [, expiresAtStr, sig] = decoded.split('.');
    // Keep the original (valid) signature but point it at a new victim.
    const forged = Buffer.from(`victim-999.${expiresAtStr}.${sig}`).toString(
      'base64url'
    );
    expect(verifyResetToken(forged, SECRET)).toBeNull();
  });

  it('rejects a token whose expiry was extended without re-signing', () => {
    const token = generateResetToken(USER, SECRET);
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [userId, , sig] = decoded.split('.');
    const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    const forged = Buffer.from(`${userId}.${farFuture}.${sig}`).toString(
      'base64url'
    );
    expect(verifyResetToken(forged, SECRET)).toBeNull();
  });

  it('rejects a signature of the wrong length without throwing', () => {
    const decoded = `${USER}.${Date.now() + 1000}.deadbeef`;
    const token = Buffer.from(decoded).toString('base64url');
    expect(verifyResetToken(token, SECRET)).toBeNull();
  });

  it('rejects a signature of the correct length but wrong value', () => {
    const expiresAt = Date.now() + 60_000;
    const realSig = crypto
      .createHmac('sha256', SECRET)
      .update(`${USER}.${expiresAt}`)
      .digest('hex');
    // Flip the first hex char — same length, valid hex, wrong bytes.
    const flipped = (realSig[0] === '0' ? '1' : '0') + realSig.slice(1);
    const token = Buffer.from(`${USER}.${expiresAt}.${flipped}`).toString(
      'base64url'
    );
    expect(verifyResetToken(token, SECRET)).toBeNull();
  });
});

describe('verifyResetToken — malformed input', () => {
  it.each([
    ['empty string', ''],
    ['not base64url of a dotted triple', Buffer.from('nope').toString('base64url')],
    ['too few parts', Buffer.from('a.b').toString('base64url')],
    ['too many parts', Buffer.from('a.b.c.d').toString('base64url')],
    ['non-numeric expiry', Buffer.from(`${USER}.notanumber.abcd`).toString('base64url')],
  ])('returns null for %s', (_label, token) => {
    expect(verifyResetToken(token, SECRET)).toBeNull();
  });
});

describe('verifyResetToken — expiry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('accepts a token before expiry and rejects it after', () => {
    vi.setSystemTime(new Date('2026-07-21T00:00:00Z'));
    const token = generateResetToken(USER, SECRET);

    // 59 minutes later — still valid (1-hour TTL).
    vi.setSystemTime(new Date('2026-07-21T00:59:00Z'));
    expect(verifyResetToken(token, SECRET)).toBe(USER);

    // 61 minutes later — expired.
    vi.setSystemTime(new Date('2026-07-21T01:01:00Z'));
    expect(verifyResetToken(token, SECRET)).toBeNull();
  });
});
