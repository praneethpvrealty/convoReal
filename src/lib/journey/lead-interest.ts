/**
 * A lead's own interest signal on a listing — the 👍 Interested tap, the
 * ⭐ Shortlist tap, a typed or portal enquiry, a Book a visit / Call me
 * back answer to a showcase check-in — lands on the contact×property
 * journey item so the Journey tab is the one place that lists who said
 * yes to what. The yes stamps a pair that is already on the journey and
 * never creates one: a share, an import or a visit request captures the
 * pair (and the journey_items insert trigger seeds the stamp from the
 * answers already on file), and a pair the agent removed from the tray
 * stays removed (JRN-009). The stamp never un-hides, moves or
 * reactivates the branch and never counts as activity on it; Interested
 * outranks Shortlisted and is never downgraded.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { writeJourneyEvent } from './events';
import type { JourneyLeadInterest } from './lead-interest-labels';

export const LEAD_INTEREST_EVENT_REASONS = {
  whatsapp_interested: 'Tapped Interested on WhatsApp',
  whatsapp_shortlist: 'Tapped Shortlist on WhatsApp',
  whatsapp_enquiry: 'Asked about the listing on WhatsApp',
  portal_enquiry: 'Enquired through a property portal',
  showcase_checkin: 'Asked for a visit or a call from the showcase check-in',
} as const;

export type LeadInterestEventSource = keyof typeof LEAD_INTEREST_EVENT_REASONS;

/** Every lead-interest event's dedupe key starts with this, so readers
 *  that look for a client's reply to a check-in can leave them out. */
export const LEAD_INTEREST_DEDUPE_PREFIX = 'lead_interest:';

const KIND_OF_SOURCE: Record<LeadInterestEventSource, JourneyLeadInterest> = {
  whatsapp_interested: 'interested',
  whatsapp_shortlist: 'shortlisted',
  whatsapp_enquiry: 'interested',
  portal_enquiry: 'interested',
  showcase_checkin: 'interested',
};

export interface RecordJourneyLeadInterestInput {
  accountId: string;
  userId: string | null;
  contactId: string;
  propertyId: string;
  source: LeadInterestEventSource;
}

export async function recordJourneyLeadInterest(
  db: SupabaseClient,
  {
    accountId,
    userId,
    contactId,
    propertyId,
    source,
  }: RecordJourneyLeadInterestInput
): Promise<{ itemId: string | null; error: string | null }> {
  const kind = KIND_OF_SOURCE[source];
  try {
    const { data: item, error: readError } = await db
      .from('journey_items')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (readError) {
      console.error('[journey/lead-interest] read failed:', readError.message);
      return { itemId: null, error: readError.message };
    }
    if (!item) return { itemId: null, error: null };

    let update = db
      .from('journey_items')
      .update({
        lead_interest: kind,
        lead_interest_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('account_id', accountId);
    if (kind === 'shortlisted') {
      update = update.or('lead_interest.is.null,lead_interest.neq.interested');
    }
    const { error } = await update;
    if (error) {
      console.error('[journey/lead-interest] stamp failed:', error.message);
      return { itemId: item.id, error: error.message };
    }

    const event = await writeJourneyEvent({
      db,
      accountId,
      itemId: item.id,
      eventType: 'client_response',
      createdBy: userId,
      reason: LEAD_INTEREST_EVENT_REASONS[source],
      dedupeKey: `${LEAD_INTEREST_DEDUPE_PREFIX}${source}`,
    });
    if (!event.ok) {
      console.error('[journey/lead-interest] event failed:', event.error);
    }
    return { itemId: item.id, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[journey/lead-interest] failed:', message);
    return { itemId: null, error: message };
  }
}

/**
 * A lead who says no to a listing (None of these fit, Not for me, Close
 * my enquiry) takes back the yes: the stamp is cleared so the Journey tab
 * stops listing them as interested, while the listing_feedback verdict
 * the caller wrote keeps the rejection for the matcher.
 */
export async function clearJourneyLeadInterest(
  db: SupabaseClient,
  {
    accountId,
    contactId,
    propertyIds,
  }: { accountId: string; contactId: string; propertyIds: string[] }
): Promise<void> {
  if (propertyIds.length === 0) return;
  const { error } = await db
    .from('journey_items')
    .update({ lead_interest: null, lead_interest_at: null })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('property_id', propertyIds)
    .not('lead_interest', 'is', null);
  if (error) {
    console.error('[journey/lead-interest] clear failed:', error.message);
  }
}
