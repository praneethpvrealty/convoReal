/**
 * Amount + unit for the contact budget fields.
 *
 * The fields used to be bare rupee inputs, so "6" meaning six crore was
 * stored as six rupees and the buyer silently matched everything cheap.
 * Capture is an amount and a unit; the column stays rupees.
 *
 * Mirrored by mobile/lib/budget-amount.ts and drift-checked by
 * src/lib/mobile-parity.test.ts.
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

/**
 * Which of the two stored budgets to match on.
 *
 * `min_budget`/`max_budget` are typed by an agent and win, because an
 * agent correcting the AI is the whole point of the field. But a value
 * two orders of magnitude off the parsed requirement is the old unit
 * typo — "6" for six crore — not a correction, and matching on it opens
 * the buyer up to every cheap listing. There, the parse wins.
 */
export function resolveBudgetBound(
  explicit: number | null,
  parsed: number | null
): number | null {
  if (explicit == null) return parsed;
  if (parsed == null || parsed <= 0) return explicit;
  if (explicit * 100 <= parsed) return parsed;
  return explicit;
}
