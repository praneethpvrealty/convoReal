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
import type { Contact, Property } from '@/types';
import { buildInventorySummary } from '@/lib/inventory-summary-builder';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { MATCHING_CONTACT_COLUMNS } from '@/lib/v1/projections';
import { accountShowcaseBase } from '@/lib/showcase/account-showcase-url';
import { matchTemplateButton } from '@/lib/whatsapp/template-copy';

/**
 * The ENGLISH wording of these buttons. Kept for existing importers
 * and for anything that needs to show the default label; the
 * authoritative set — every language, plus the inbound matcher — is
 * BUTTON_LABELS in template-copy.ts. Do not add a new comparison
 * against these: it would only ever match English taps.
 *
 * Button text on property_enquiry_response and
 * property_enquiry_photos. Both templates ask for the same thing, so
 * one constant covers both.
 */
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
 *
 * Delegates to matchTemplateButton, which scans the label in EVERY
 * language we send. This used to compare against the three English
 * constants above, which was correct while every template was English
 * and silently wrong the moment one was not: a lead who tapped the
 * Kannada "ಹೆಚ್ಚಿನ ವಿವರ ಕಳುಹಿಸಿ" fell through to null and got the
 * silence this module was written to eliminate.
 *
 * Still case- and whitespace-insensitive, so a typed "send more
 * details" reaches the same handler as the tap.
 */
export function parseTemplateQuickReply(
  text: string | null | undefined
): TemplateQuickReply | null {
  switch (matchTemplateButton(text)) {
    case 'send_more_details':
      return 'property_details';
    case 'inventory_full_list':
      return 'inventory_full_list';
    case 'site_visit':
      return 'site_visit';
    default:
      // The enquiry/journey buttons are real actions, but they route
      // through the webhook's own handler rather than this one.
      return null;
  }
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
  contactId: string
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
  contactId?: string
): Promise<string | null> {
  const { data } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false })
    .limit(60);
  let properties = (data || []) as Property[];
  if (properties.length === 0) return null;
  let contact: Contact | null = null;
  if (contactId) {
    const [contactResult, feedbackResult] = await Promise.all([
      db
        .from('contacts')
        .select(`${MATCHING_CONTACT_COLUMNS}, last_inquired_property_id`)
        .eq('account_id', accountId)
        .eq('id', contactId)
        .eq('status', 'active')
        .maybeSingle(),
      db
        .from('listing_feedback')
        .select('property_id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('verdict', 'rejected'),
    ]);
    if (contactResult.data) {
      [contact] = await attachInquiredListingTypes(db, accountId, [
        contactResult.data as unknown as Contact,
      ]);
    }
    if (!feedbackResult.error) {
      const rejected = new Set(
        (feedbackResult.data ?? []).map((row) => row.property_id)
      );
      properties = properties.filter((property) => !rejected.has(property.id));
    }
  }
  if (properties.length === 0 && !contact) return null;
  const basePortalUrl = await accountShowcaseBase(db, accountId);
  let portalUrl = basePortalUrl;
  if (contactId) {
    try {
      const tracked = new URL(basePortalUrl);
      tracked.searchParams.set('v', contactId);
      portalUrl = tracked.toString();
    } catch {
      portalUrl = basePortalUrl;
    }
  }
  return buildInventorySummary(properties, {
    portalUrl,
    contact,
    recipientName: contact?.name,
  });
}
