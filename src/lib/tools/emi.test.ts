import { describe, expect, it } from 'vitest';

import { MAX_TENURE_YEARS, calculateEmi, loanAmount, monthlyEmi } from './emi';
import { formatInrCompact, parseAmount } from './format';

describe('calculateEmi', () => {
  it('[PUB-005] computes the standard reducing-balance EMI', () => {
    expect(monthlyEmi(5_000_000, 8.5, 240)).toBeCloseTo(43_391.16, 0);
    const result = calculateEmi({
      principal: 5_000_000,
      annualRatePercent: 8.5,
      tenureYears: 20,
    });
    expect(result.months).toBe(240);
    expect(result.emi).toBe(43_391);
    expect(result.totalPayment).toBe(
      Math.round(monthlyEmi(5_000_000, 8.5, 240) * 240)
    );
    expect(result.totalInterest).toBe(result.totalPayment - 5_000_000);
  });

  it('[PUB-005] amortises year by year until the balance reaches zero', () => {
    const result = calculateEmi({
      principal: 3_000_000,
      annualRatePercent: 9,
      tenureYears: 10,
    });
    expect(result.schedule).toHaveLength(10);
    expect(result.schedule[0].year).toBe(1);
    expect(result.schedule[0].interestPaid).toBeGreaterThan(
      result.schedule[9].interestPaid
    );
    expect(result.schedule[9].balance).toBe(0);
    const principalPaid = result.schedule.reduce(
      (sum, year) => sum + year.principalPaid,
      0
    );
    expect(Math.abs(principalPaid - 3_000_000)).toBeLessThanOrEqual(10);
    for (let i = 1; i < result.schedule.length; i += 1) {
      expect(result.schedule[i].balance).toBeLessThan(
        result.schedule[i - 1].balance
      );
    }
  });

  it('[PUB-005] handles a zero rate, an empty loan and an oversized tenure', () => {
    const free = calculateEmi({
      principal: 1_200_000,
      annualRatePercent: 0,
      tenureYears: 10,
    });
    expect(free.emi).toBe(10_000);
    expect(free.totalInterest).toBe(0);

    const empty = calculateEmi({
      principal: 0,
      annualRatePercent: 8,
      tenureYears: 20,
    });
    expect(empty.emi).toBe(0);
    expect(empty.totalPayment).toBe(0);

    const long = calculateEmi({
      principal: 1_000_000,
      annualRatePercent: 8,
      tenureYears: 99,
    });
    expect(long.months).toBe(MAX_TENURE_YEARS * 12);
  });

  it('[PUB-005] derives the loan from the price and the down payment', () => {
    expect(loanAmount(10_000_000, 20)).toBe(8_000_000);
    expect(loanAmount(10_000_000, 150)).toBe(0);
    expect(loanAmount(10_000_000, -5)).toBe(10_000_000);
  });
});

describe('amount formatting', () => {
  it('[PUB-005] prints lakhs and crores and reads them back', () => {
    expect(formatInrCompact(12_500_000)).toBe('₹1.25 Cr');
    expect(formatInrCompact(10_000_000)).toBe('₹1 Cr');
    expect(formatInrCompact(4_500_000)).toBe('₹45 L');
    expect(formatInrCompact(80_000)).toBe('₹80,000');
    expect(parseAmount('1.25 cr')).toBe(12_500_000);
    expect(parseAmount('45 lakh')).toBe(4_500_000);
    expect(parseAmount('₹80,000')).toBe(80_000);
    expect(parseAmount('50k')).toBe(50_000);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});
