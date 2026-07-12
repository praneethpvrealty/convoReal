import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketStatsConfig } from './stats-config';

/**
 * Anonymized market-stats aggregation engine.
 *
 * Ethical contract (do not weaken):
 *  1. CONSENT AT THE SOURCE — the first query selects consenting
 *     accounts (`accounts.data_sharing_consent = true`); no other
 *     tenant's rows are ever fetched, let alone aggregated.
 *  2. K-ANONYMITY — a cell is only written when backed by at least
 *     `k_threshold` DISTINCT accounts. Suppressed cells are counted in
 *     the summary but never persisted.
 *  3. NO PII — cells carry only geography/type/month dimensions and
 *     numeric aggregates. No ids, names, phones, or free text beyond
 *     normalized locality strings.
 *
 * Refresh model: recompute the trailing `months_back` month-buckets and
 * replace that window atomically-ish (delete window → insert fresh
 * cells). Replacing rather than upserting means a cell that falls below
 * K (e.g. an account withdrew consent) disappears on the next run.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatsSummary {
  consentingAccounts: number;
  supplyCells: number;
  demandCells: number;
  suppressedCells: number;
  errors: number;
}

interface PropertyRow {
  account_id: string;
  city: string | null;
  sublocality: string | null;
  locality_canonical: string | null;
  type: string | null;
  listing_type: string | null;
  price: number | null;
  area_sqft: number | null;
  status: string | null;
  sold_price: number | null;
  created_at: string;
  status_changed_at: string | null;
}

interface ContactRow {
  account_id: string;
  min_budget: number | null;
  max_budget: number | null;
  pref_budget_min: number | null;
  pref_budget_max: number | null;
  areas_of_interest: string[] | null;
  pref_areas: string[] | null;
  property_interests: string[] | null;
  pref_property_types: string[] | null;
}

interface Cell {
  period_month: string;
  side: 'supply' | 'demand';
  city: string;
  locality: string;
  property_type: string;
  listing_type: string;
  prices: number[];
  areas: number[];
  soldPrices: number[];
  daysToSell: number[];
  budgets: number[];
  listingsCount: number;
  soldCount: number;
  buyerCount: number;
  accounts: Set<string>;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Lowercase + whitespace-collapsed so "Whitefield " and "whitefield"
 *  land in the same cell. Consumers can title-case for display. */
export function normalizeToken(raw: string | null | undefined): string | null {
  const t = (raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

/** First day of a timestamp's month, as a DATE string. */
function monthBucket(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function cellKey(c: Pick<Cell, 'period_month' | 'side' | 'city' | 'locality' | 'property_type' | 'listing_type'>): string {
  return [c.period_month, c.side, c.city, c.locality, c.property_type, c.listing_type].join('|');
}

function getCell(cells: Map<string, Cell>, dims: Pick<Cell, 'period_month' | 'side' | 'city' | 'locality' | 'property_type' | 'listing_type'>): Cell {
  const key = cellKey(dims);
  let cell = cells.get(key);
  if (!cell) {
    cell = {
      ...dims,
      prices: [],
      areas: [],
      soldPrices: [],
      daysToSell: [],
      budgets: [],
      listingsCount: 0,
      soldCount: 0,
      buyerCount: 0,
      accounts: new Set(),
    };
    cells.set(key, cell);
  }
  return cell;
}

export async function runMarketStats(
  admin: SupabaseClient,
  config: MarketStatsConfig,
  now: Date = new Date(),
): Promise<StatsSummary> {
  const summary: StatsSummary = {
    consentingAccounts: 0,
    supplyCells: 0,
    demandCells: 0,
    suppressedCells: 0,
    errors: 0,
  };

  // 1. Consent gate — the only accounts whose data ever enters memory.
  const { data: accounts, error: accErr } = await admin
    .from('accounts')
    .select('id')
    .eq('data_sharing_consent', true);
  if (accErr) {
    console.error('[market-stats] consent query failed:', accErr.message);
    summary.errors++;
    return summary;
  }
  const accountIds = (accounts ?? []).map((a) => (a as { id: string }).id);
  summary.consentingAccounts = accountIds.length;

  const currentMonth = monthBucket(now.toISOString());
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (config.months_back - 1), 1),
  );
  const windowStartIso = windowStart.toISOString();
  const windowStartMonth = monthBucket(windowStartIso);

  if (accountIds.length === 0) {
    const { error: delErr } = await admin
      .from('market_stats')
      .delete()
      .gte('period_month', windowStartMonth);
    if (delErr) {
      console.error('[market-stats] window delete failed on empty accounts:', delErr.message);
      summary.errors++;
    }
    return summary;
  }

  const cells = new Map<string, Cell>();
  const PROP_COLS =
    'account_id, city, sublocality, locality_canonical, type, listing_type, price, area_sqft, status, sold_price, created_at, status_changed_at';

  // 2. Supply — two simple queries instead of one .or(): (a) listings
  //    created in the window, (b) listings SOLD in the window (their
  //    created_at may be far older).
  const [createdRes, soldRes] = await Promise.all([
    admin
      .from('properties')
      .select(PROP_COLS)
      .in('account_id', accountIds)
      .gte('created_at', windowStartIso),
    admin
      .from('properties')
      .select(PROP_COLS)
      .in('account_id', accountIds)
      .eq('status', 'Sold')
      .gte('status_changed_at', windowStartIso),
  ]);
  if (createdRes.error || soldRes.error) {
    console.error(
      '[market-stats] supply query failed:',
      createdRes.error?.message ?? soldRes.error?.message,
    );
    summary.errors++;
    return summary;
  }

  const dimsFor = (row: PropertyRow, month: string) => {
    const city = normalizeToken(row.city);
    const locality = normalizeToken(row.locality_canonical) ?? normalizeToken(row.sublocality);
    const type = normalizeToken(row.type);
    if (!city || !locality || !type) return null; // can't place geographically
    return {
      period_month: month,
      side: 'supply' as const,
      city,
      locality,
      property_type: type,
      listing_type: normalizeToken(row.listing_type) ?? 'sale',
    };
  };

  // Listing activity buckets by created_at month.
  for (const row of (createdRes.data ?? []) as PropertyRow[]) {
    const dims = dimsFor(row, monthBucket(row.created_at));
    if (!dims) continue;
    const cell = getCell(cells, dims);
    cell.listingsCount++;
    cell.accounts.add(row.account_id);
    if (typeof row.price === 'number' && row.price > 0) cell.prices.push(row.price);
    if (typeof row.area_sqft === 'number' && row.area_sqft > 0) cell.areas.push(row.area_sqft);
  }

  // Sale outcomes bucket by the month the status flipped to Sold
  // (status_changed_at, migration 110 — durable, unlike updated_at).
  for (const row of (soldRes.data ?? []) as PropertyRow[]) {
    if (!row.status_changed_at) continue;
    const dims = dimsFor(row, monthBucket(row.status_changed_at));
    if (!dims) continue;
    const cell = getCell(cells, dims);
    cell.soldCount++;
    cell.accounts.add(row.account_id);
    if (typeof row.sold_price === 'number' && row.sold_price > 0) {
      cell.soldPrices.push(row.sold_price);
    }
    const days =
      (new Date(row.status_changed_at).getTime() - new Date(row.created_at).getTime()) / DAY_MS;
    if (days >= 0) cell.daysToSell.push(Math.round(days));
  }

  // 3. Demand — a snapshot of active buyer preferences, assigned to the
  //    current month. Contacts have no reliable city, so demand cells
  //    use the sentinel city 'all' with the normalized area as locality.
  const { data: contacts, error: contactErr } = await admin
    .from('contacts')
    .select(
      'account_id, min_budget, max_budget, pref_budget_min, pref_budget_max, areas_of_interest, pref_areas, property_interests, pref_property_types',
    )
    .in('account_id', accountIds)
    .eq('status', 'active');
  if (contactErr) {
    console.error('[market-stats] demand query failed:', contactErr.message);
    summary.errors++;
  }

  for (const row of (contacts ?? []) as ContactRow[]) {
    const areas = new Set(
      [...(row.areas_of_interest ?? []), ...(row.pref_areas ?? [])]
        .map(normalizeToken)
        .filter(Boolean) as string[],
    );
    if (areas.size === 0) continue;
    const types = new Set(
      [...(row.property_interests ?? []), ...(row.pref_property_types ?? [])]
        .map(normalizeToken)
        .filter(Boolean) as string[],
    );
    if (types.size === 0) types.add('any');

    const lo = row.min_budget ?? row.pref_budget_min;
    const hi = row.max_budget ?? row.pref_budget_max;
    const budget =
      typeof lo === 'number' && typeof hi === 'number'
        ? (lo + hi) / 2
        : typeof hi === 'number'
          ? hi
          : typeof lo === 'number'
            ? lo
            : null;

    for (const area of areas) {
      for (const type of types) {
        const cell = getCell(cells, {
          period_month: currentMonth,
          side: 'demand',
          city: 'all',
          locality: area,
          property_type: type,
          listing_type: 'any',
        });
        cell.buyerCount++;
        cell.accounts.add(row.account_id);
        if (budget !== null && budget > 0) cell.budgets.push(budget);
      }
    }
  }

  // 4. k-anonymity suppression, then materialize rows.
  const rows: Record<string, unknown>[] = [];
  for (const cell of cells.values()) {
    if (cell.accounts.size < config.k_threshold) {
      summary.suppressedCells++;
      continue;
    }
    rows.push({
      period_month: cell.period_month,
      side: cell.side,
      city: cell.city,
      locality: cell.locality,
      property_type: cell.property_type,
      listing_type: cell.listing_type,
      listings_count: cell.side === 'supply' ? cell.listingsCount : null,
      median_price: median(cell.prices),
      median_area_sqft: median(cell.areas),
      sold_count: cell.side === 'supply' ? cell.soldCount : null,
      median_sold_price: median(cell.soldPrices),
      median_days_to_sell: median(cell.daysToSell),
      buyer_count: cell.side === 'demand' ? cell.buyerCount : null,
      median_budget: median(cell.budgets),
      accounts_count: cell.accounts.size,
      computed_at: now.toISOString(),
    });
    if (cell.side === 'supply') summary.supplyCells++;
    else summary.demandCells++;
  }

  // 5. Replace the recomputed window: delete-then-insert (not upsert) so
  //    cells that dropped below K — e.g. after a consent withdrawal —
  //    vanish instead of lingering at their last value.
  const { error: delErr } = await admin
    .from('market_stats')
    .delete()
    .gte('period_month', windowStartMonth);
  if (delErr) {
    console.error('[market-stats] window delete failed:', delErr.message);
    summary.errors++;
    return summary;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await admin
      .from('market_stats')
      .insert(rows.slice(i, i + 500));
    if (insErr) {
      console.error('[market-stats] insert failed:', insErr.message);
      summary.errors++;
    }
  }

  return summary;
}
