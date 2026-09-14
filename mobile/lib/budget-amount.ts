/**
 * Amount + unit for the contact budget fields.
 *
 * Mirrors src/lib/contacts/budget-amount.ts. Kept in step by
 * src/lib/mobile-parity.test.ts, which reads this file by path: a drift
 * means the same typed amount is stored as a different number of rupees
 * on one surface than the other.
 */
export type BudgetUnit = 'rupee' | 'lakh' | 'crore';

export const BUDGET_UNIT_MULTIPLIER: Record<BudgetUnit, number> = {
  rupee: 1,
  lakh: 100000,
  crore: 10000000,
};

export const BUDGET_UNIT_OPTIONS: { value: BudgetUnit; label: string }[] = [
  { value: 'crore', label: 'Crore' },
  { value: 'lakh', label: 'Lakh' },
  { value: 'rupee', label: '₹' },
];

export function budgetToRupees(
  amount: string,
  unit: BudgetUnit
): number | null {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * BUDGET_UNIT_MULTIPLIER[unit]);
}

export function rupeesToBudgetAmount(
  value: number | string | null | undefined
): { amount: string; unit: BudgetUnit } {
  const rupees = value == null ? NaN : Number(value);
  if (!Number.isFinite(rupees) || rupees <= 0)
    return { amount: '', unit: 'crore' };
  const unit: BudgetUnit =
    rupees >= BUDGET_UNIT_MULTIPLIER.crore
      ? 'crore'
      : rupees >= BUDGET_UNIT_MULTIPLIER.lakh
        ? 'lakh'
        : 'rupee';
  const amount = rupees / BUDGET_UNIT_MULTIPLIER[unit];
  return { amount: String(Number(amount.toFixed(4))), unit };
}

export function budgetRangeError(
  min: number | null,
  max: number | null
): string | null {
  if (min == null || max == null) return null;
  if (min > max)
    return 'Minimum budget is above the maximum — check the amounts and units.';
  return null;
}
