import { describe, it, expect } from 'vitest';

import { BUDGET_STEPS, budgetStepLabel } from './money-ladder';

describe('budgetStepLabel', () => {
  it('says the ladder the way an agent does', () => {
    expect(budgetStepLabel(500000)).toBe('₹5 L');
    expect(budgetStepLabel(10000000)).toBe('₹1 Cr');
    expect(budgetStepLabel(15000000)).toBe('₹1.5 Cr');
    expect(budgetStepLabel(1000000000)).toBe('₹100 Cr');
  });
});

describe('BUDGET_STEPS', () => {
  it('climbs without repeating a step', () => {
    for (let i = 1; i < BUDGET_STEPS.length; i++) {
      expect(BUDGET_STEPS[i]).toBeGreaterThan(BUDGET_STEPS[i - 1]);
    }
  });

  it('renders a distinct label for every step', () => {
    expect(new Set(BUDGET_STEPS.map(budgetStepLabel)).size).toBe(
      BUDGET_STEPS.length
    );
  });
});
