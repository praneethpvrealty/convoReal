import type { SupabaseClient } from '@supabase/supabase-js';

import type { JourneyOverviewMode } from './overview-state';

export async function ownedJourneySubjects(
  supabase: SupabaseClient,
  accountId: string,
  mode: JourneyOverviewMode,
  subjectIds: string[]
): Promise<boolean> {
  const column = mode === 'buyer' ? 'contact_id' : 'property_id';
  const { data, error } = await supabase
    .from('journey_items')
    .select(column)
    .eq('account_id', accountId)
    .in(column, subjectIds)
    .limit(2000);
  if (error) throw error;
  const found = new Set(
    (data ?? []).map(
      (row) => (row as unknown as Record<string, string>)[column]
    )
  );
  return subjectIds.every((id) => found.has(id));
}
