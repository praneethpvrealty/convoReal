import { describe, expect, it } from 'vitest';
import {
  budgetRangeError,
  budgetToRupees,
  rupeesToBudgetAmount,
} from './budget-amount';

describe('budgetToRupees', () => {
  it('reads a bare number against its unit', () => {
    expect(budgetToRupees('6', 'crore')).toBe(60000000);
    expect(budgetToRupees('2.5', 'crore')).toBe(25000000);
    expect(budgetToRupees('45', 'lakh')).toBe(4500000);
    expect(budgetToRupees('40000', 'rupee')).toBe(40000);
  });

  it('rejects blank and non-positive amounts', () => {
    expect(budgetToRupees('', 'crore')).toBeNull();
    expect(budgetToRupees('  ', 'crore')).toBeNull();
    expect(budgetToRupees('0', 'crore')).toBeNull();
    expect(budgetToRupees('-4', 'crore')).toBeNull();
    expect(budgetToRupees('abc', 'crore')).toBeNull();
  });
});

describe('rupeesToBudgetAmount', () => {
  it('picks the largest unit that keeps the amount readable', () => {
    expect(rupeesToBudgetAmount(60000000)).toEqual({
      amount: '6',
      unit: 'crore',
    });
    expect(rupeesToBudgetAmount(4500000)).toEqual({
      amount: '45',
      unit: 'lakh',
    });
    expect(rupeesToBudgetAmount(40000)).toEqual({
      amount: '40000',
      unit: 'rupee',
    });
  });

  it('round-trips every unit', () => {
    for (const rupees of [40000, 4500000, 25000000, 60000000, 1500000000]) {
      const { amount, unit } = rupeesToBudgetAmount(rupees);
      expect(budgetToRupees(amount, unit)).toBe(rupees);
    }
  });

  it('treats missing and junk values as empty', () => {
    expect(rupeesToBudgetAmount(null)).toEqual({ amount: '', unit: 'crore' });
    expect(rupeesToBudgetAmount(undefined)).toEqual({
      amount: '',
      unit: 'crore',
    });
    expect(rupeesToBudgetAmount(0)).toEqual({ amount: '', unit: 'crore' });
  });
});

describe('budgetRangeError', () => {
  it('rejects an inverted range', () => {
    expect(budgetRangeError(60000000, 50000000)).toMatch(/above the maximum/);
  });

  it('allows a half-open or ordered range', () => {
    expect(budgetRangeError(50000000, 60000000)).toBeNull();
    expect(budgetRangeError(null, 60000000)).toBeNull();
    expect(budgetRangeError(50000000, null)).toBeNull();
    expect(budgetRangeError(50000000, 50000000)).toBeNull();
  });
});
