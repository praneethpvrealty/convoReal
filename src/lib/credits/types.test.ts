import { describe, it, expect } from 'vitest';
import {
  recomputeReferralTier,
  referralTierMultiplier,
  deriveCreditStatus,
  MONTHLY_GRANT,
  COMMITMENT_BONUS_PCT,
  CYCLE_MONTHS,
} from './types';

describe('recomputeReferralTier', () => {
  it('returns bronze below the silver threshold', () => {
    expect(recomputeReferralTier(0)).toBe('bronze');
    expect(recomputeReferralTier(1)).toBe('bronze');
    expect(recomputeReferralTier(2)).toBe('bronze');
  });

  it('returns silver at 3+ conversions, below gold threshold', () => {
    expect(recomputeReferralTier(3)).toBe('silver');
    expect(recomputeReferralTier(6)).toBe('silver');
  });

  it('returns gold at 7+ conversions, below platinum threshold', () => {
    expect(recomputeReferralTier(7)).toBe('gold');
    expect(recomputeReferralTier(14)).toBe('gold');
  });

  it('returns platinum at 15+ conversions', () => {
    expect(recomputeReferralTier(15)).toBe('platinum');
    expect(recomputeReferralTier(100)).toBe('platinum');
  });
});

describe('referralTierMultiplier', () => {
  it('applies the documented bonus percentages per tier', () => {
    expect(referralTierMultiplier('bronze')).toBe(1);
    expect(referralTierMultiplier('silver')).toBeCloseTo(1.1);
    expect(referralTierMultiplier('gold')).toBeCloseTo(1.25);
    expect(referralTierMultiplier('platinum')).toBeCloseTo(1.5);
  });
});

describe('deriveCreditStatus', () => {
  it('is healthy above 100 credits', () => {
    expect(deriveCreditStatus(101)).toBe('healthy');
    expect(deriveCreditStatus(10000)).toBe('healthy');
  });

  it('is low at or below 100 but above 20', () => {
    expect(deriveCreditStatus(100)).toBe('low');
    expect(deriveCreditStatus(21)).toBe('low');
  });

  it('is critical at or below 20 but above 0', () => {
    expect(deriveCreditStatus(20)).toBe('critical');
    expect(deriveCreditStatus(1)).toBe('critical');
  });

  it('is empty at exactly 0 (and negative, defensively)', () => {
    expect(deriveCreditStatus(0)).toBe('empty');
    expect(deriveCreditStatus(-5)).toBe('empty');
  });
});

describe('plan/cycle constant tables stay in sync with the design doc', () => {
  it('monthly grants match the documented per-plan values', () => {
    expect(MONTHLY_GRANT.solo_pro).toBe(500);
    expect(MONTHLY_GRANT.team).toBe(2000);
    expect(MONTHLY_GRANT.agency).toBe(8000);
  });

  it('commitment bonus percentages match the documented cycle incentives', () => {
    expect(COMMITMENT_BONUS_PCT.monthly).toBe(0);
    expect(COMMITMENT_BONUS_PCT['3month']).toBeCloseTo(0.15);
    expect(COMMITMENT_BONUS_PCT['6month']).toBeCloseTo(0.30);
    expect(COMMITMENT_BONUS_PCT.annual).toBeCloseTo(0.50);
  });

  it('computes the documented Solo Pro Annual example: 500x12 base + 50% bonus = 9000cr', () => {
    const base = MONTHLY_GRANT.solo_pro * CYCLE_MONTHS.annual;
    const bonus = Math.round(base * COMMITMENT_BONUS_PCT.annual);
    expect(base).toBe(6000);
    expect(bonus).toBe(3000);
    expect(base + bonus).toBe(9000);
  });

  it('computes the documented Team 6-month example: 2000x6 base + 30% bonus = 15600cr', () => {
    const base = MONTHLY_GRANT.team * CYCLE_MONTHS['6month'];
    const bonus = Math.round(base * COMMITMENT_BONUS_PCT['6month']);
    expect(base).toBe(12000);
    expect(bonus).toBe(3600);
    expect(base + bonus).toBe(15600);
  });
});
