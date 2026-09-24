import { describe, expect, it } from 'vitest';

import {
  TARGET_YIELDS,
  calculateRentalYield,
  monthlyRentForYield,
} from './rental-yield';

describe('calculateRentalYield', () => {
  it('[PUB-006] computes gross yield on the price and net yield on the total investment', () => {
    const result = calculateRentalYield({
      price: 10_000_000,
      monthlyRent: 30_000,
      annualExpenses: 40_000,
      vacancyMonths: 1,
      purchaseCosts: 600_000,
    });
    expect(result.grossAnnualRent).toBe(360_000);
    expect(result.grossYield).toBeCloseTo(0.036, 6);
    expect(result.vacancyLoss).toBe(30_000);
    expect(result.netAnnualIncome).toBe(290_000);
    expect(result.totalInvestment).toBe(10_600_000);
    expect(result.netYield).toBeCloseTo(290_000 / 10_600_000, 6);
    expect(result.paybackYears).toBeCloseTo(10_600_000 / 290_000, 6);
  });

  it('[PUB-006] treats missing costs as zero and clamps vacancy to a year', () => {
    const bare = calculateRentalYield({
      price: 5_000_000,
      monthlyRent: 15_000,
    });
    expect(bare.netYield).toBe(bare.grossYield);
    expect(bare.netAnnualIncome).toBe(180_000);

    const empty = calculateRentalYield({
      price: 5_000_000,
      monthlyRent: 15_000,
      vacancyMonths: 20,
    });
    expect(empty.vacancyLoss).toBe(180_000);
    expect(empty.netAnnualIncome).toBe(0);
    expect(empty.paybackYears).toBeNull();

    const negative = calculateRentalYield({
      price: 5_000_000,
      monthlyRent: 10_000,
      annualExpenses: 200_000,
      vacancyMonths: -3,
    });
    expect(negative.vacancyLoss).toBe(0);
    expect(negative.netAnnualIncome).toBe(-80_000);
    expect(negative.netYield).toBeLessThan(0);
    expect(negative.paybackYears).toBeNull();
  });

  it('[PUB-006] yields zero rather than dividing by an empty price', () => {
    const result = calculateRentalYield({ price: 0, monthlyRent: 20_000 });
    expect(result.grossYield).toBe(0);
    expect(result.netYield).toBe(0);
    expect(result.paybackYears).toBeNull();
  });

  it('[PUB-006] inverts to the monthly rent a target yield needs', () => {
    expect(monthlyRentForYield(12_000_000, 0.03)).toBe(30_000);
    expect(monthlyRentForYield(12_000_000, 0)).toBe(0);
    expect(monthlyRentForYield(-1, 0.03)).toBe(0);
    for (const target of TARGET_YIELDS) {
      const rent = monthlyRentForYield(10_000_000, target);
      expect(
        calculateRentalYield({ price: 10_000_000, monthlyRent: rent })
          .grossYield
      ).toBeCloseTo(target, 5);
    }
  });
});
