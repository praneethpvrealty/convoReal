import { STAKEHOLDER_HIDDEN_DEAL_FIELDS } from './financials';

/**
 * The one visibility resolver for the Transaction Workspace.
 *
 * Phase 1 has no external surface, but the rule ships now so Phase 2's
 * stakeholder links can only ever read through it. Every external
 * representation of a deal, a bundle, a milestone or an event passes
 * through `projectForAudience`; nothing else may build one.
 *
 * Audiences:
 *   internal — a member of the account. Sees everything.
 *   external — one stakeholder on one side of one or more deals. Sees
 *              only the deals they are party to, only the fields that
 *              are not internal-only, and only the items whose
 *              visibility includes their side.
 */

export type DealSide = 'buyer' | 'seller';

export type DealVisibility =
  | 'internal'
  | 'buyer_side'
  | 'seller_side'
  | 'all_stakeholders';

export type Audience =
  | { kind: 'internal' }
  | { kind: 'external'; side: DealSide; contactId: string };

export interface DealParties {
  buyer_contact_ids: readonly string[];
  seller_contact_ids: readonly string[];
}

export interface VisibleItem {
  visibility: DealVisibility;
  [key: string]: unknown;
}

export function sideCanSee(side: DealSide, visibility: DealVisibility): boolean {
  switch (visibility) {
    case 'internal':
      return false;
    case 'all_stakeholders':
      return true;
    case 'buyer_side':
      return side === 'buyer';
    case 'seller_side':
      return side === 'seller';
  }
}

export function isPartyTo(audience: Audience, parties: DealParties): boolean {
  if (audience.kind === 'internal') return true;
  const ids =
    audience.side === 'buyer' ? parties.buyer_contact_ids : parties.seller_contact_ids;
  return ids.includes(audience.contactId);
}

function stripInternal<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!STAKEHOLDER_HIDDEN_DEAL_FIELDS.includes(key)) out[key] = value;
  }
  return out as Partial<T>;
}

export interface ProjectableDeal extends Record<string, unknown> {
  id: string;
  parties: DealParties;
  items?: readonly VisibleItem[];
}

export interface ProjectedDeal {
  deal: Record<string, unknown>;
  items: VisibleItem[];
}

/**
 * Project one deal for an audience. Returns null when the audience is
 * not party to it — a deal an outsider is not on does not exist for
 * them, not even as an id.
 */
export function projectDealForAudience(
  deal: ProjectableDeal,
  audience: Audience
): ProjectedDeal | null {
  const { parties, items = [], ...row } = deal;
  if (audience.kind === 'internal') {
    return { deal: row, items: [...items] };
  }
  if (!isPartyTo(audience, parties)) return null;
  return {
    deal: stripInternal(row),
    items: items.filter((item) => sideCanSee(audience.side, item.visibility)),
  };
}

/**
 * Project a bundle. Each member deal is resolved on its own, so a
 * seller on one plot never sees the other plot's seller, terms, or
 * milestones — the buyer who is on both sees both.
 */
export function projectBundleForAudience(
  deals: readonly ProjectableDeal[],
  audience: Audience
): ProjectedDeal[] {
  return deals
    .map((deal) => projectDealForAudience(deal, audience))
    .filter((d): d is ProjectedDeal => d !== null);
}
