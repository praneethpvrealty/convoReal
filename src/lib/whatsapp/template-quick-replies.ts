// Answers for the quick-reply buttons on the Engine's own templates.
//
// A template button tap arrives as an ordinary inbound message carrying
// message.button.text, opens the 24-hour window, and — before this
// module — stopped there for the property and inventory templates: a
// lead who tapped "Send more details" got silence until an agent
// noticed the thread. These are the missing handlers, in the same shape
// as the owner-digest and buyer-alert button handlers in the webhook.
//
// Pure routing plus one send each; the actual property message is the
// same one the interactive "Yes" reply sends, so a lead sees identical
// content however they asked for it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';
import { buildInventorySummary } from '@/lib/inventory-summary-builder';
import { accountShowcaseBase } from '@/lib/showcase/account-showcase-url';

/** Button text on property_enquiry_response and
 *  property_enquiry_photos. Both templates ask for the same thing, so
 *  one constant covers both. */
export const SEND_MORE_DETAILS_BUTTON = 'Send more details';
/** inventory_update buttons. */
export const INVENTORY_FULL_LIST_BUTTON = 'Send full list';
export const INVENTORY_SITE_VISIT_BUTTON = 'Book a site visit';

export type TemplateQuickReply =
  | 'property_details'
  | 'inventory_full_list'
  | 'site_visit';

/**
 * Which of our template buttons this inbound message is, if any.
 * Matched case-insensitively on the trimmed text so a typed "send more
 * details" reaches the same handler as the tap.
 */
export function parseTemplateQuickReply(
  text: string | null | undefined,
): TemplateQuickReply | null {
  if (!text) return null;
  const cleaned = text.trim().toLowerCase();
  if (cleaned.length > 40) return null;
  if (cleaned === SEND_MORE_DETAILS_BUTTON.toLowerCase()) return 'property_details';
  if (cleaned === INVENTORY_FULL_LIST_BUTTON.toLowerCase()) return 'inventory_full_list';
  if (cleaned === INVENTORY_SITE_VISIT_BUTTON.toLowerCase()) return 'site_visit';
  return null;
}

/**
 * The listing this contact was most recently sent — what "more details"
 * refers to. property_shares records every share (manual, Radar, digest)
 * with its contact, so the newest row for this pair is the subject of
 * the template the lead just tapped.
 */
export async function lastSharedPropertyId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await db
    .from('property_shares')
    .select('property_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.property_id as string | undefined) ?? null;
}

/** Sent when the lead asks for details we cannot pin to a listing —
 *  better than silence, and it still leaves the thread with an agent. */
export const DETAILS_FALLBACK_TEXT =
  'Thanks for confirming. One of our specialists will send the photos and full details shortly.';

export const SITE_VISIT_ACK_TEXT =
  'Thanks — noted. One of our specialists will call you shortly to arrange a convenient time.';

/**
 * The account's published, available inventory as the digest text the
 * "Send full list" button promises. Returns null when there is nothing
 * to list, so the caller can fall back rather than send an empty digest.
 */
export async function buildFullListMessage(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false })
    .limit(60);
  const properties = (data || []) as Property[];
  if (properties.length === 0) return null;
  const portalUrl = await accountShowcaseBase(db, accountId);
  return buildInventorySummary(properties, { portalUrl });
}
