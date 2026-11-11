import type { SupabaseClient } from '@supabase/supabase-js';

import { denAdmin, type DenContext } from './auth';
import { loadOwnedProperty } from './properties';
import {
  buildPropertyValue,
  isStillOwned,
  portfolioTotals,
  type PortfolioValue,
} from './value-view';
import {
  marketLookbackStart,
  marketPlacement,
  marketRange,
  placementKey,
  type MarketPlacement,
  type MarketRateCell,
} from '@/lib/market/valuation';

export const VALUE_PROPERTY_LIMIT = 100;

const VALUE_SELECT =
  'id, account_id, title, status, listing_type, price, city, sublocality, locality_canonical, type, area_sqft, declared:owner_property_values(declared_value), guidance:property_guidance_values(total_value, created_at)';

interface ValueRow {
  id: string;
  account_id: string;
  title: string | null;
  status: string | null;
  listing_type: string | null;
  price: number | string | null;
  city: string | null;
  sublocality: string | null;
  locality_canonical: string | null;
  type: string | null;
  area_sqft: number | string | null;
  declared:
    | { declared_value: number | string }[]
    | { declared_value: number | string }
    | null;
  guidance:
    { total_value: number | string; created_at: string | null }[] | null;
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function first<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadOwnerPortfolioValue(
  ctx: DenContext,
  db: SupabaseClient = denAdmin(),
  now: Date = new Date()
): Promise<PortfolioValue> {
  const contactIds = ctx.links.map((l) => l.contactId);
  if (contactIds.length === 0) {
    return { properties: [], totals: portfolioTotals([]), truncated: false };
  }

  const { data, error } = await db
    .from('properties')
    .select(VALUE_SELECT)
    .in('owner_contact_id', contactIds)
    .neq('listing_source', 'agent')
    .eq('declared.den_user_id', ctx.denUserId)
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'guidance', ascending: false })
    .limit(1, { referencedTable: 'guidance' })
    .limit(VALUE_PROPERTY_LIMIT + 1);
  if (error) throw error;

  const linkedAccounts = new Set(ctx.links.map((l) => l.accountId));
  const fetched = (data ?? []) as unknown as ValueRow[];
  const truncated = fetched.length > VALUE_PROPERTY_LIMIT;
  const rows = fetched
    .slice(0, VALUE_PROPERTY_LIMIT)
    .filter(
      (row) =>
        linkedAccounts.has(row.account_id) &&
        isStillOwned(row.status, row.listing_type)
    );

  const cellsByPlacement = await loadMarketCells(db, rows, now);
  const agencyByAccount = new Map(
    ctx.links.map((l) => [l.accountId, l.agencyName])
  );

  const properties = rows.map((row) => {
    const placement = marketPlacement(row);
    const cells = placement
      ? (cellsByPlacement.get(`${row.account_id}|${placementKey(placement)}`) ??
        [])
      : [];
    const guidance = first(row.guidance);
    const guidanceTotal = amount(guidance?.total_value);
    return buildPropertyValue({
      property_id: row.id,
      title: row.title,
      agency_name: agencyByAccount.get(row.account_id) ?? null,
      listing_type: row.listing_type,
      price: amount(row.price),
      declared: amount(first(row.declared)?.declared_value),
      guidance:
        guidanceTotal !== null
          ? { total: guidanceTotal, saved_at: guidance?.created_at ?? null }
          : null,
      market: marketRange(amount(row.area_sqft), cells),
    });
  });

  return { properties, totals: portfolioTotals(properties), truncated };
}

async function loadMarketCells(
  db: SupabaseClient,
  rows: ValueRow[],
  now: Date
): Promise<Map<string, MarketRateCell[]>> {
  const out = new Map<string, MarketRateCell[]>();
  const accountIds = Array.from(new Set(rows.map((r) => r.account_id)));
  if (accountIds.length === 0) return out;

  const { data: consenting, error: consentError } = await db
    .from('accounts')
    .select('id')
    .in('id', accountIds)
    .eq('data_sharing_consent', true);
  if (consentError) {
    console.error('[den/value] consent lookup failed:', consentError.message);
    return out;
  }
  const consentingIds = new Set(
    (consenting ?? []).map((a) => (a as { id: string }).id)
  );

  const placements = new Map<string, MarketPlacement>();
  const accountsByPlacement = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!consentingIds.has(row.account_id)) continue;
    if (amount(row.area_sqft) === null) continue;
    const placement = marketPlacement(row);
    if (!placement) continue;
    const key = placementKey(placement);
    placements.set(key, placement);
    const accounts = accountsByPlacement.get(key) ?? new Set<string>();
    accounts.add(row.account_id);
    accountsByPlacement.set(key, accounts);
  }
  if (placements.size === 0) return out;

  const wanted = Array.from(placements.values());
  const { data: cells, error } = await db
    .from('market_stats')
    .select(
      'period_month, city, locality, property_type, priced_count, median_price_per_sqft, p25_price_per_sqft, p75_price_per_sqft'
    )
    .eq('side', 'supply')
    .eq('listing_type', 'sale')
    .gte('period_month', marketLookbackStart(now))
    .in('city', Array.from(new Set(wanted.map((p) => p.city))))
    .in('locality', Array.from(new Set(wanted.map((p) => p.locality))))
    .limit(2000);
  if (error) {
    console.error('[den/value] market cells lookup failed:', error.message);
    return out;
  }

  for (const cell of (cells ?? []) as MarketRateCell[]) {
    const key = placementKey(cell);
    for (const accountId of accountsByPlacement.get(key) ?? []) {
      const scoped = `${accountId}|${key}`;
      const list = out.get(scoped) ?? [];
      list.push(cell);
      out.set(scoped, list);
    }
  }
  return out;
}

export async function saveOwnerDeclaredValue(
  ctx: DenContext,
  propertyId: string,
  value: number | null,
  db: SupabaseClient = denAdmin()
): Promise<'saved' | 'cleared' | 'not_found'> {
  const property = await loadOwnedProperty(ctx, propertyId);
  if (!property) return 'not_found';

  if (value === null) {
    const { error } = await db
      .from('owner_property_values')
      .delete()
      .eq('property_id', propertyId)
      .eq('den_user_id', ctx.denUserId);
    if (error) throw error;
    return 'cleared';
  }

  const { error } = await db.from('owner_property_values').upsert(
    {
      account_id: property.account_id as string,
      property_id: propertyId,
      den_user_id: ctx.denUserId,
      declared_value: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id' }
  );
  if (error) throw error;
  return 'saved';
}
