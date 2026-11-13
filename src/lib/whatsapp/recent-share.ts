import type { SupabaseClient } from '@supabase/supabase-js';
import {
  lastSharedAt,
  recentShareFilter,
  recentShareSince,
} from '@/lib/inventory/recent-share';

export async function findRecentShare(
  db: SupabaseClient,
  args: {
    accountId: string;
    propertyId: string;
    contactId: string;
    now?: Date;
  }
): Promise<string | null> {
  const { data, error } = await db
    .from('property_shares')
    .select('created_at, last_shared_at')
    .eq('account_id', args.accountId)
    .eq('property_id', args.propertyId)
    .eq('contact_id', args.contactId)
    .or(recentShareFilter(recentShareSince(args.now)))
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return lastSharedAt(data);
}
