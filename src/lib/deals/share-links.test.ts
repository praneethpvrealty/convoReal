import { describe, expect, it } from 'vitest';

import {
  DEAL_SHARE_MAX_TTL_MS,
  OTP_LENGTH,
  dealShareUrl,
  generateOtpCode,
  hashClientIp,
  hashDealShareToken,
  hashOtpCode,
  isLinkLive,
  isValidOtpFormat,
  linkState,
  mintDealShareToken,
  otpMatches,
  parseShareLinkInput,
  signUnlock,
  ttlMsForKey,
  verifyUnlock,
} from './share-links';

const NOW = new Date('2026-09-18T10:00:00Z');

describe('[TXW-009] share-link tokens', () => {
  it('mints a long random token and stores only its hash', () => {
    const minted = mintDealShareToken(ttlMsForKey('7d'), NOW);
    expect(minted.token.length).toBeGreaterThanOrEqual(40);
    expect(minted.hash).toBe(hashDealShareToken(minted.token));
    expect(minted.hash).not.toContain(minted.token);
    expect(minted.prefix).toBe(minted.token.slice(0, 8));
    expect(minted.expiresAt).toBe('2026-09-25T10:00:00.000Z');
    expect(mintDealShareToken().token).not.toBe(minted.token);
  });

  it('caps expiry at 30 days whatever the caller asks for', () => {
    const minted = mintDealShareToken(365 * 24 * 60 * 60 * 1000, NOW);
    expect(new Date(minted.expiresAt).getTime() - NOW.getTime()).toBe(
      DEAL_SHARE_MAX_TTL_MS
    );
    expect(ttlMsForKey('forever')).toBe(ttlMsForKey('7d'));
  });

  it('reports active, expired and revoked, and revoked wins', () => {
    const live = { expires_at: '2026-09-25T10:00:00Z', revoked_at: null };
    expect(linkState(live, NOW)).toBe('active');
    expect(isLinkLive(live, NOW)).toBe(true);
    expect(
      linkState({ ...live, expires_at: '2026-09-18T09:59:59Z' }, NOW)
    ).toBe('expired');
    expect(
      linkState({ ...live, revoked_at: '2026-09-17T00:00:00Z' }, NOW)
    ).toBe('revoked');
    expect(
      linkState(
        {
          expires_at: '2020-01-01T00:00:00Z',
          revoked_at: '2020-01-01T00:00:00Z',
        },
        NOW
      )
    ).toBe('revoked');
  });

  it('carries the token in the path', () => {
    expect(dealShareUrl('abc', 'https://app.convoreal.com/')).toBe(
      'https://app.convoreal.com/deal/abc'
    );
  });

  it('parses the mint request', () => {
    expect(
      parseShareLinkInput({
        stakeholder_id: ' s1 ',
        ttl: '24h',
        otp_required: true,
      })
    ).toEqual({
      ok: true,
      value: {
        stakeholderId: 's1',
        ttlMs: 24 * 60 * 60 * 1000,
        otpRequired: true,
      },
    });
    expect(parseShareLinkInput({})).toEqual({
      ok: false,
      error: 'stakeholder_id is required',
    });
  });

  it('never stores a raw client address', () => {
    expect(hashClientIp('203.0.113.9')).toHaveLength(32);
    expect(hashClientIp('203.0.113.9')).not.toContain('203');
    expect(hashClientIp(null)).toBeNull();
  });
});

describe('[TXW-011] one-time codes and unlocks', () => {
  it('generates six digits and validates the format', () => {
    const code = generateOtpCode();
    expect(code).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    expect(isValidOtpFormat('123456')).toBe(true);
    expect(isValidOtpFormat('12345')).toBe(false);
    expect(isValidOtpFormat('abcdef')).toBe(false);
  });

  it('hashes a code with the server key, bound to its link', () => {
    const hash = hashOtpCode('123456', 'link-1');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('123456');
    expect(otpMatches('123456', 'link-1', hash)).toBe(true);
    expect(otpMatches('123457', 'link-1', hash)).toBe(false);
    expect(otpMatches('123456', 'link-2', hash)).toBe(false);
  });

  it('signs an unlock for one link that expires and cannot be reused elsewhere', () => {
    const { unlock, expiresAt } = signUnlock('link-1', NOW);
    expect(new Date(expiresAt).getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
    expect(verifyUnlock(unlock, 'link-1', NOW)).toBe(true);
    expect(verifyUnlock(unlock, 'link-2', NOW)).toBe(false);
    expect(
      verifyUnlock(unlock, 'link-1', new Date(NOW.getTime() + 31 * 60 * 1000))
    ).toBe(false);
    expect(verifyUnlock(`${unlock}x`, 'link-1', NOW)).toBe(false);
    expect(verifyUnlock(null, 'link-1', NOW)).toBe(false);
    const [id, exp] = unlock.split('.');
    expect(
      verifyUnlock(
        `${id}.${Number(exp) + 1000}.${unlock.split('.')[2]}`,
        'link-1',
        NOW
      )
    ).toBe(false);
  });
});
