import { describe, expect, it } from 'vitest';

import { normalizeReferralSource } from './referral';

describe('normalizeReferralSource', () => {
  it('[PVL-006] keeps a short partner slug and refuses anything else', () => {
    expect(normalizeReferralSource('INDmoney')).toBe('indmoney');
    expect(normalizeReferralSource(' partner_app-2 ')).toBe('partner_app-2');
    expect(normalizeReferralSource('')).toBeNull();
    expect(normalizeReferralSource('-leading')).toBeNull();
    expect(normalizeReferralSource('has space')).toBeNull();
    expect(normalizeReferralSource('<script>')).toBeNull();
    expect(normalizeReferralSource('a'.repeat(41))).toBeNull();
    expect(normalizeReferralSource(42)).toBeNull();
    expect(normalizeReferralSource(null)).toBeNull();
  });
});
