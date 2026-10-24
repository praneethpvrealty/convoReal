import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A buyer's own "no" that names no reason must not inherit the reason
 * an agent gave in a "Not a fit" mark on the same row, and must not
 * wipe a reason the buyer gave earlier either. Clears the reason on
 * agent marks only, before the buyer's write lands; the source trigger
 * stamps the row as the contact's on this write. Best-effort: a failure
 * leaves the agent's reason showing, never blocks the buyer's answer.
 */
export async function clearAgentMarkReasons(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  propertyIds: string[]
): Promise<void> {
  if (propertyIds.length === 0) return;
  try {
    const { error } = await db
      .from('listing_feedback')
      .update({ reason: null })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .in('property_id', propertyIds)
      .eq('source', 'agent')
      .select('id');
    if (error) throw error;
  } catch (err) {
    console.error('[listing-feedback] agent reason release failed:', err);
  }
}
