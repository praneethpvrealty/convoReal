import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountContext } from '@/lib/auth/account';

/**
 * Server-side helpers shared by the Transaction Workspace routes.
 * Every read here runs under the caller's own RLS client and still
 * names the account explicitly, as the rest of /api/deals does.
 */

export interface DealHead {
  id: string;
  account_id: string;
  title: string;
  contact_id: string | null;
  property_id: string | null;
  deal_room_id: string | null;
  deal_group_id: string | null;
  source_journey_item_id: string | null;
}

export async function loadDealHead(
  ctx: Pick<AccountContext, 'supabase' | 'accountId'>,
  dealId: string
): Promise<DealHead | null> {
  const { data } = await ctx.supabase
    .from('deals')
    .select(
      'id, account_id, title, contact_id, property_id, deal_room_id, deal_group_id, source_journey_item_id'
    )
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  return (data as DealHead | null) ?? null;
}

/** The caller's display name, snapshotted onto timeline rows so the
 *  event still reads correctly after the member leaves. */
export async function actorName(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('full_name')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  const name = (data as { full_name?: string | null } | null)?.full_name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}
