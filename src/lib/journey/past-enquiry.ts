// ============================================================
// "Is this relationship past the enquiry?" — one answer, read by every
// surface that chases quiet leads.
//
// The follow-up radar (src/lib/contacts/follow-up-nudges.ts), the Today
// panel and Focus all key on WhatsApp silence. That signal inverts once
// a deal reaches legal: a buyer a week from registration is quiet
// because the work moved to lawyers and the sub-registrar. Asking them
// "are you still considering it?" is both wrong and, via the check-in
// template's "Close my enquiry" button, destructive — that button marks
// the contact dead.
//
// journey_items already records the furthest stage per contact×property
// pair, and journey_stages.stage_kind (migration 286) says which stages
// mean the deal is in flight. This module joins the two.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { PAST_ENQUIRY_STAGE_KINDS } from '@/components/journey/shared';

/**
 * Contacts with an active journey item on a closing or won stage,
 * mapped to the stage they sit on so a caller can say which one.
 *
 * `accountId` is optional because the callers differ: cron and webhook
 * code holds a service-role client and must scope explicitly, while the
 * Today loaders pass an RLS-scoped client that is already pinned to one
 * account. Neither path interpolates an unbounded list into a filter —
 * a stage list is single digits per account, and the item query is
 * filtered server-side rather than by contact id.
 */
export async function loadPastEnquiryContacts(
  db: SupabaseClient,
  accountId?: string
): Promise<Map<string, string>> {
  let stageQuery = db
    .from('journey_stages')
    .select('id, name')
    .in('stage_kind', PAST_ENQUIRY_STAGE_KINDS);
  if (accountId) stageQuery = stageQuery.eq('account_id', accountId);
  const { data: stageRows } = await stageQuery;
  const stages = (stageRows ?? []) as { id: string; name: string }[];
  if (!stages.length) return new Map();

  const stageNames = new Map(stages.map((s) => [s.id, s.name]));
  let itemQuery = db
    .from('journey_items')
    .select('contact_id, stage_id')
    .eq('status', 'active')
    .in('stage_id', [...stageNames.keys()]);
  if (accountId) itemQuery = itemQuery.eq('account_id', accountId);
  const { data: itemRows } = await itemQuery;

  const out = new Map<string, string>();
  for (const item of (itemRows ?? []) as {
    contact_id: string;
    stage_id: string;
  }[]) {
    const name = stageNames.get(item.stage_id);
    if (name) out.set(item.contact_id, name);
  }
  return out;
}
