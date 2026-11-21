import { isEnquiryBudgetAnchor } from '@/lib/matching';

export const BUDGET_OVERSHOOT_FACTOR = 1.25;

export const STATED_BUDGET_COLUMNS =
  'pref_budget_max, max_budget, pref_budget_anchor';

export interface StatedBudgetFields {
  pref_budget_max?: number | string | null;
  max_budget?: number | string | null;
  pref_budget_anchor?: number | string | null;
}

export function listingExceedsStatedBudget(
  price: number | string | null | undefined,
  contact: StatedBudgetFields | null | undefined
): boolean {
  const amount = Number(price || 0);
  const stated = Number(contact?.pref_budget_max ?? contact?.max_budget ?? 0);
  if (!(amount > 0) || !(stated > 0)) return false;
  if (
    isEnquiryBudgetAnchor(
      stated,
      contact?.pref_budget_anchor == null
        ? null
        : Number(contact.pref_budget_anchor)
    )
  )
    return false;
  return amount >= stated * BUDGET_OVERSHOOT_FACTOR;
}
