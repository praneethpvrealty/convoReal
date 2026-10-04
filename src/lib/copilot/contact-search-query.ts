import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONTACT_SEARCH_LIMIT,
  type ContactSearchMatch,
  type ContactSearchQuery,
  type ContactSearchResult,
} from './contact-search';

interface SearchContext {
  supabase: SupabaseClient;
  accountId: string;
}

interface FoundContactRow {
  id: string;
  name: string | null;
  second_name: string | null;
  company: string | null;
  classification: string | null;
  min_budget: number | string | null;
  max_budget: number | string | null;
  matched_area: string | null;
  score: number;
  total: number | string;
}

function toNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function labelFor(row: FoundContactRow): string {
  return (
    [row.name, row.second_name].filter(Boolean).join(' ').trim() ||
    row.company?.trim() ||
    'Unnamed contact'
  );
}

export async function findCopilotContacts(
  ctx: SearchContext,
  query: ContactSearchQuery
): Promise<ContactSearchResult> {
  const { data, error } = await ctx.supabase.rpc('copilot_find_contacts', {
    p_account_id: ctx.accountId,
    p_area_probes: query.areaProbes,
    p_type_probes: query.typeProbes,
    p_bhk_min: query.bhkMin,
    p_bhk_max: query.bhkMax,
    p_budget_min: query.budgetMin,
    p_budget_max: query.budgetMax,
    p_listing_types: query.listingTypes,
    p_limit: CONTACT_SEARCH_LIMIT,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FoundContactRow[];
  const matches: ContactSearchMatch[] = rows.map((row) => ({
    id: row.id,
    label: labelFor(row),
    classification: row.classification,
    budgetMin: toNumber(row.min_budget),
    budgetMax: toNumber(row.max_budget),
    matchedArea: row.matched_area,
  }));
  return { matches, total: toNumber(rows[0]?.total ?? 0) ?? 0 };
}
