// ============================================================
// Portfolio (owner + buyer) row shapes for /api/v1.
//
// The heavy lifting is in migration 257's RPCs — these only coerce
// what PostgREST puts on the wire. NUMERIC and BIGINT both arrive as
// strings (a bigint does not fit a JS number and node-postgres will
// not silently narrow it), so every count and rupee figure needs
// converting before it reaches a caller that will do arithmetic on it.
//
// Money stays a plain number of rupees, the same unit as
// properties.price everywhere else on this surface.
// ============================================================

export type Row = Record<string, unknown>;

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Money and averages: null is meaningful ("nothing to average"), so
 *  it survives rather than collapsing to zero. */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export interface OwnerPortfolioStats {
  linked_owners: number;
  owners_with_listings: number;
  properties: {
    total: number;
    available: number;
    under_contract: number;
    sold: number;
    published: number;
  };
  asking_value_available: number | null;
  asking_price_avg_available: number | null;
  bids: { pending: number; accepted: number };
}

export function toOwnerStats(row: Row | null): OwnerPortfolioStats {
  const r = row ?? {};
  return {
    linked_owners: int(r.linked_owners),
    owners_with_listings: int(r.owners_with_listings),
    properties: {
      total: int(r.properties_total),
      available: int(r.properties_available),
      under_contract: int(r.properties_under_contract),
      sold: int(r.properties_sold),
      published: int(r.properties_published),
    },
    asking_value_available: money(r.asking_value_available),
    asking_price_avg_available: money(r.asking_price_avg_available),
    bids: { pending: int(r.bids_pending), accepted: int(r.bids_accepted) },
  };
}

export interface BuyerPortfolioStats {
  linked_buyers: number;
  buyers_with_budget: number;
  buyers_unconstrained_budget: number;
  buyers_with_requirement: number;
  budget: {
    min_avg: number | null;
    max_avg: number | null;
    max_median: number | null;
    max_lowest: number | null;
    max_highest: number | null;
  };
  shortlist: { items: number; buyers_with_items: number };
}

export function toBuyerStats(row: Row | null): BuyerPortfolioStats {
  const r = row ?? {};
  return {
    linked_buyers: int(r.linked_buyers),
    buyers_with_budget: int(r.buyers_with_budget),
    buyers_unconstrained_budget: int(r.buyers_unconstrained_budget),
    buyers_with_requirement: int(r.buyers_with_requirement),
    budget: {
      min_avg: money(r.budget_min_avg),
      max_avg: money(r.budget_max_avg),
      max_median: money(r.budget_max_median),
      max_lowest: money(r.budget_max_lowest),
      max_highest: money(r.budget_max_highest),
    },
    shortlist: {
      items: int(r.shortlist_items),
      buyers_with_items: int(r.buyers_with_shortlist),
    },
  };
}

export interface OwnerPortfolioRow {
  den_user_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  linked_at: string | null;
  digest_frequency: string | null;
  properties: { total: number; available: number; sold: number };
  asking_value_available: number | null;
  bids_pending: number;
}

export function toOwnerRow(row: Row): OwnerPortfolioRow {
  return {
    den_user_id: String(row.den_user_id),
    contact_id: String(row.contact_id),
    // The contact record is the agency's own name for this person;
    // display_name is what they typed into the portal. Prefer the
    // agency's, fall back to theirs.
    name: str(row.contact_name) ?? str(row.display_name),
    phone: str(row.contact_phone),
    linked_at: str(row.linked_at),
    digest_frequency: str(row.digest_frequency),
    properties: {
      total: int(row.properties_total),
      available: int(row.properties_available),
      sold: int(row.properties_sold),
    },
    asking_value_available: money(row.asking_value_available),
    bids_pending: int(row.bids_pending),
  };
}

export interface BuyerPortfolioRow {
  buyer_user_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  linked_at: string | null;
  budget: { min: number | null; max: number | null; unconstrained: boolean };
  areas_of_interest: string[];
  requirements: string | null;
  requirement_active: boolean;
  shortlist_count: number;
}

export function toBuyerRow(row: Row): BuyerPortfolioRow {
  return {
    buyer_user_id: String(row.buyer_user_id),
    contact_id: String(row.contact_id),
    name: str(row.contact_name) ?? str(row.display_name),
    phone: str(row.contact_phone),
    linked_at: str(row.linked_at),
    budget: {
      min: money(row.min_budget),
      max: money(row.max_budget),
      unconstrained: Boolean(row.no_budget),
    },
    areas_of_interest: list(row.areas_of_interest),
    requirements: str(row.requirements),
    requirement_active: row.requirement_active !== false,
    shortlist_count: int(row.shortlist_count),
  };
}

/** The RPCs repeat the unpaged total on every row (`count(*) OVER ()`)
 *  so a page costs one query rather than two. An empty page carries no
 *  rows and therefore no total — zero is the only honest answer. */
export function totalFromRows(rows: Row[]): number {
  return rows.length > 0 ? int(rows[0].total_count) : 0;
}
