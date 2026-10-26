import type { SupabaseClient } from '@supabase/supabase-js';
import { describedListingAmong } from '@/lib/ai/described-listing';
import { asksDetailsOfDescribedListing } from '@/lib/ai/requirement-signal';

const RECENT_SHARES = 20;

/**
 * The listing already shared with this contact that a details request
 * names by its price, size or a word of its own, or null. A message
 * that names one is a question about it, never a requirement.
 */
export async function detailsRequestForSharedListing(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  text: string | null | undefined
): Promise<string | null> {
  if (!asksDetailsOfDescribedListing(text)) return null;
  try {
    const { data: shares } = await db
      .from('property_shares')
      .select('property_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(RECENT_SHARES);
    const ids = [
      ...new Set((shares ?? []).map((s) => s.property_id as string)),
    ];
    if (ids.length === 0) return null;
    const { data: candidates } = await db
      .from('properties')
      .select(
        'id, title, location, sublocality, project, price, area_sqft, super_built_area, land_area, land_area_unit, bedrooms'
      )
      .eq('account_id', accountId)
      .in('id', ids);
    return describedListingAmong(text, candidates ?? []);
  } catch {
    return null;
  }
}
