import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchEvent, Contact, Property } from '@/types';

type DB = SupabaseClient;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Load all unresolved Match Radar events ('new' status) for the active account.
 * Hydrates the subject property (if kind = 'new_property') or contact (if kind = 'buyer_updated').
 */
export async function loadMatchEvents(db: DB): Promise<MatchEvent[]> {
  const { data, error } = await db
    .from('match_events')
    .select('*, property:properties(*), contact:contacts(*)')
    .eq('status', 'new')
    .order('created_at', { ascending: false });

  if (error) throw error;

  type EventRow = Omit<MatchEvent, 'property' | 'contact'> & {
    property: Property | Property[] | null;
    contact: Contact | Contact[] | null;
  };

  return ((data ?? []) as unknown as EventRow[]).map((row) => ({
    ...row,
    property: one(row.property),
    contact: one(row.contact),
  })) as MatchEvent[];
}
