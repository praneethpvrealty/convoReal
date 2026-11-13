import type { SupabaseClient } from '@supabase/supabase-js';
import { recentShareSince } from '@/lib/inventory/recent-share';

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
    .select('created_at')
    .eq('account_id', args.accountId)
    .eq('property_id', args.propertyId)
    .eq('contact_id', args.contactId)
    .gte('created_at', recentShareSince(args.now))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data.created_at as string | null) ?? null;
}
