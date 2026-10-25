import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_MERGE_HOPS = 5;

export async function mergeWinnerId(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  let id = contactId;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop += 1) {
    const { data, error } = await db
      .from('contacts')
      .select('id, is_merged, merged_into_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    const row = data as {
      id: string;
      is_merged: boolean | null;
      merged_into_id: string | null;
    } | null;
    if (error || !row) return null;
    if (!row.is_merged || !row.merged_into_id) return row.id;
    id = row.merged_into_id;
  }
  return null;
}
