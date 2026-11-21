import { statedBudgetSignature } from '@/lib/matching';
import { MATCHING_CONTACT_COLUMNS } from '@/lib/v1/projections';
import type { Contact } from '@/types';

export const BUDGET_OVERSHOOT_FACTOR = 1.25;

export const STATED_BUDGET_COLUMNS = MATCHING_CONTACT_COLUMNS;

export type StatedBudgetFields = Partial<Contact>;

/**
 * The maximum the contact stated, as the matcher reads it: the widest
 * ceiling across every brief it ranks them on, and none when a brief
 * leaves the budget open or the only figure is the price of the listing
 * they enquired about.
 */
export function statedBudgetMax(
  contact: StatedBudgetFields | null | undefined
): number | null {
  if (!contact) return null;
  const max = statedBudgetSignature(contact as Contact)?.max ?? null;
  return max !== null && max > 0 ? max : null;
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
