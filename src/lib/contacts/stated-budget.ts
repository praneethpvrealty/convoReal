import { isEnquiryBudgetAnchor } from '@/lib/matching';
import { resolveBudgetBound } from '@/lib/contacts/budget-amount';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import type { Contact } from '@/types';

export const BUDGET_OVERSHOOT_FACTOR = 1.25;

export const STATED_BUDGET_COLUMNS =
  'pref_budget_max, max_budget, pref_budget_anchor, requirements, requirement_profiles';

export type StatedBudgetFields = Pick<
  Contact,
  | 'pref_budget_max'
  | 'max_budget'
  | 'pref_budget_anchor'
  | 'requirements'
  | 'requirement_profiles'
>;

const positive = (value: unknown): number | null =>
  value != null && Number(value) > 0 ? Number(value) : null;

/**
 * The maximum the contact stated, resolved as the matcher does: the
 * active requirement profile's budget when the contact has no brief of
 * their own, the agent-typed figure ahead of the parsed one, and never a
 * figure seeded from the listing they enquired about.
 */
export function statedBudgetMax(
  contact: StatedBudgetFields | null | undefined
): number | null {
  if (!contact) return null;
  const source = resolveRequirementSource(contact as Contact);
  const explicit = positive(source.max_budget);
  const max = resolveBudgetBound(explicit, positive(source.pref_budget_max));
  if (
    explicit === null &&
    isEnquiryBudgetAnchor(max, source.pref_budget_anchor)
  )
    return null;
  return max;
}

export interface BudgetedListing {
  price?: number | string | null;
  rent_per_month?: number | string | null;
  listing_type?: string | null;
}

export function listingExceedsStatedBudget(
  listing: BudgetedListing | null | undefined,
  contact: StatedBudgetFields | null | undefined
): boolean {
  const amount = Number(
    (listing?.listing_type === 'Rent'
      ? listing.rent_per_month
      : listing?.price) || 0
  );
  const stated = statedBudgetMax(contact);
  if (!(amount > 0) || stated === null) return false;
  return amount >= stated * BUDGET_OVERSHOOT_FACTOR;
}
