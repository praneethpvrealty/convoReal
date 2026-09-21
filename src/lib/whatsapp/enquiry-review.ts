// The lead's other open enquiries, played back with one-tap closes.
//
// "Close my enquiry" is about the listing the template named, not the
// search: a lead who drops one villa is still looking at everything
// else they were shared. The tap opened a 24-hour window, so once the
// close is filed the same window shows them what else is still open
// on their journey and lets them close any of those with one tap — or
// keep the lot. Either answer lands on the journey, and the requirement
// ladder follows so the moment ends with their brief sorted too.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';
import { sendAlertsOnboarding } from '@/lib/whatsapp/alerts-onboarding';
import { JOURNEY_CHECKIN_KEEP_BUTTON } from '@/lib/whatsapp/journey-checkin-template';
import { createNotification } from '@/lib/notifications/create';
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { PAST_ENQUIRY_STAGE_KINDS } from '@/components/journey/shared';

export const ENQUIRY_REVIEW_ID_PREFIX = 'enqrev_';
export const ENQUIRY_REVIEW_KEEP_ID = `${ENQUIRY_REVIEW_ID_PREFIX}keep`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Meta caps a list at ten rows; one is the keep row. */
export const MAX_REVIEWED_ENQUIRIES = 9;

export const CLOSED_FROM_WHATSAPP_REASON =
  'Lead closed their enquiry from WhatsApp';

export interface OpenEnquiry {
  itemId: string;
  property: { id: string; title: string | null; property_code?: string | null };
}

export function enquiryLabel(p: OpenEnquiry['property']): string {
  const title = (p.title || '').trim();
  const code = (p.property_code || '').trim();
  if (title && code) return `${title} (${code})`;
  return title || code || 'the property';
}

/**
 * The branches a lead can still close: active, and not already past
 * the enquiry — a deal at token, legal or registration, or one won, is
 * still `active` on the journey but is not an open enquiry, and a
 * one-tap close on it would drop a transaction in flight.
 */
export async function loadOpenEnquiries(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<OpenEnquiry[]> {
  const { data } = await db
    .from('journey_items')
    .select(
      'id, property:properties(id, title, property_code), stage:journey_stages!journey_items_stage_id_fkey(stage_kind)'
    )
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false });
  type Stage = { stage_kind: string | null };
  const rows = (data ?? []) as Array<{
    id: string;
    property: OpenEnquiry['property'] | OpenEnquiry['property'][] | null;
    stage: Stage | Stage[] | null;
  }>;
  const one = <T>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;
  const past = PAST_ENQUIRY_STAGE_KINDS as readonly string[];
  return rows
    .flatMap((row) => {
      const property = one(row.property);
      const kind = one(row.stage)?.stage_kind ?? null;
      if (!property || (kind && past.includes(kind))) return [];
      return [{ itemId: row.id, property }];
    })
    .slice(0, MAX_REVIEWED_ENQUIRIES);
}

/**
 * Files one property-scoped close: the listing is rejected for this
 * contact, the journey branch is dropped, and the timeline says so.
 * The contact itself is untouched — closing a listing is not closing
 * the lead.
 */
export async function closePropertyEnquiry(args: {
  db: SupabaseClient;
  accountId: string;
  contact: { id: string; name?: string | null };
  property: OpenEnquiry['property'];
  reason?: string;
}): Promise<void> {
  const { db, accountId, contact, property } = args;
  const reason = args.reason ?? CLOSED_FROM_WHATSAPP_REASON;
  const now = new Date().toISOString();

  await db.from('listing_feedback').upsert(
    {
      account_id: accountId,
      contact_id: contact.id,
      property_id: property.id,
      verdict: 'rejected',
    },
    { onConflict: 'contact_id,property_id' }
  );

  const { data: item } = await db
    .from('journey_items')
    .select('id, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .eq('property_id', property.id)
    .eq('status', 'active')
    .maybeSingle();
  if (item) {
    const row = item as { id: string; stage_id: string };
    await db
      .from('journey_items')
      .update({
        status: 'dropped',
        drop_reason: reason,
        dropped_at: now,
        updated_at: now,
      })
      .eq('id', row.id);
    await db.from('journey_events').insert({
      account_id: accountId,
      item_id: row.id,
      event_type: 'dropped',
      from_stage_id: row.stage_id,
      to_stage_id: row.stage_id,
      reason,
    });
  }

  const name = leadFirstName(contact.name) || 'The lead';
  await db.from('contact_notes').insert({
    contact_id: contact.id,
    account_id: accountId,
    user_id: null,
    note_text: `🚪 ${name} closed their enquiry on ${enquiryLabel(property)}`,
  });
}

export function buildEnquiryReviewBody(
  enquiries: OpenEnquiry[],
  acknowledgement?: string | null
): string {
  const lines = enquiries.map(
    (e, i) => `${i + 1}. ${enquiryLabel(e.property)}`
  );
  const intro =
    enquiries.length === 1
      ? 'You still have one open enquiry with us:'
      : `You still have ${enquiries.length} open enquiries with us:`;
  return [
    ...(acknowledgement ? [acknowledgement, ''] : []),
    intro,
    ...lines,
    '',
    'Close any that no longer fit, or keep them all open and we will keep you posted.',
  ].join('\n');
}

export function buildEnquiryReviewSections(
  enquiries: OpenEnquiry[]
): InteractiveListSection[] {
  const rows = enquiries.slice(0, MAX_REVIEWED_ENQUIRIES).map((e, i) => ({
    id: `${ENQUIRY_REVIEW_ID_PREFIX}close_${e.property.id}`,
    title: `Close enquiry ${i + 1}`,
    description: (e.property.title || enquiryLabel(e.property)).slice(0, 72),
  }));
  rows.push({
    id: ENQUIRY_REVIEW_KEEP_ID,
    title: 'Keep them all open',
    description: 'We will keep you posted on each one',
  });
  return [{ rows }];
}

/**
 * Sends the open-enquiry list. Returns false when the lead has nothing
 * open — the caller then moves on to the requirement ladder — and
 * never throws.
 */
export async function sendEnquiryReview(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  acknowledgement?: string | null;
  enquiries?: OpenEnquiry[];
}): Promise<boolean> {
  const { db, accountId, userId, contactId, conversationId } = args;
  try {
    const enquiries =
      args.enquiries ?? (await loadOpenEnquiries(db, accountId, contactId));
    if (enquiries.length === 0) return false;
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId,
      conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody: buildEnquiryReviewBody(enquiries, args.acknowledgement),
      interactiveButtonLabel: 'Review',
      interactiveSections: buildEnquiryReviewSections(enquiries),
      allowDeadContact: true,
      customDbClient: db,
    });
    return result.success;
  } catch (err) {
    console.error('[enquiry-review] send failed:', err);
    return false;
  }
}

/**
 * The step after a close is filed: the other open enquiries when there
 * are any, otherwise the next missing rung of the requirement ladder
 * (or the current matches when the brief is complete).
 */
export async function continueAfterEnquiryClose(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  acknowledgement?: string | null;
  /** The acknowledgement already asked for a typed reply, so with
   *  nothing to review the ladder would ask a second question on top. */
  reviewOnly?: boolean;
}): Promise<'review' | 'ladder' | 'none'> {
  const { reviewOnly, ...rest } = args;
  const reviewed = await sendEnquiryReview(rest);
  if (reviewed) return 'review';
  if (reviewOnly) return 'none';
  await sendAlertsOnboarding(rest);
  return 'ladder';
}

/** Ids arrive from the webhook, so nothing embedded is trusted. */
export function parseEnquiryReviewReply(
  replyId: string
): { action: 'keep' } | { action: 'close'; propertyId: string } | null {
  if (replyId === ENQUIRY_REVIEW_KEEP_ID) return { action: 'keep' };
  const closePrefix = `${ENQUIRY_REVIEW_ID_PREFIX}close_`;
  if (!replyId.startsWith(closePrefix)) return null;
  const propertyId = replyId.slice(closePrefix.length);
  return UUID_RE.test(propertyId) ? { action: 'close', propertyId } : null;
}

/**
 * Routes a tapped enqrev_* reply. Returns true when the tap was
 * consumed; false for ids this module does not own or a property
 * outside the account. Re-entrant: a close re-sends the list with the
 * rest, and the last close or a keep hands over to the ladder.
 */
export async function handleEnquiryReviewReply(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: { id: string; name?: string | null };
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const { db, accountId, configOwnerUserId, contact, conversationId } = args;
  const parsed = parseEnquiryReviewReply(args.replyId);
  if (!parsed) return false;

  try {
    const next = {
      db,
      accountId,
      userId: configOwnerUserId,
      contactId: contact.id,
      conversationId,
    };

    if (parsed.action === 'keep') {
      const open = await loadOpenEnquiries(db, accountId, contact.id);
      const now = new Date().toISOString();
      for (const enquiry of open) {
        await db.from('journey_events').insert({
          account_id: accountId,
          item_id: enquiry.itemId,
          event_type: 'client_response',
          reason: JOURNEY_CHECKIN_KEEP_BUTTON,
        });
        await db
          .from('journey_items')
          .update({ updated_at: now })
          .eq('id', enquiry.itemId);
      }
      await sendAlertsOnboarding({
        ...next,
        acknowledgement:
          open.length === 1
            ? 'Great — that enquiry stays open and we will keep you posted on it.'
            : 'Great — those enquiries stay open and we will keep you posted on each one.',
      });
      return true;
    }

    const { data: property } = await db
      .from('properties')
      .select('id, title, property_code, user_id')
      .eq('id', parsed.propertyId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!property) return false;
    const typed = property as OpenEnquiry['property'] & {
      user_id?: string | null;
    };

    await closePropertyEnquiry({ db, accountId, contact, property: typed });

    const { data: contactRow } = await db
      .from('contacts')
      .select('assigned_agent_id')
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .maybeSingle();
    const label = enquiryLabel(typed);
    const name = leadFirstName(contact.name) || 'The lead';
    await createNotification({
      accountId,
      userId:
        (contactRow?.assigned_agent_id as string | null) ??
        typed.user_id ??
        configOwnerUserId,
      type: 'new_message',
      title: `🚪 ${name} closed their enquiry on ${label}`,
      body: 'Closed from the open-enquiry review on WhatsApp.',
      entityType: 'contact',
      entityId: contact.id,
      link: `/journey?contact=${contact.id}`,
      channels: { inApp: true, push: true, whatsapp: false },
    });

    await continueAfterEnquiryClose({
      ...next,
      acknowledgement: `Closed — *${label}* is off your list.`,
    });
    return true;
  } catch (err) {
    console.error('[enquiry-review] reply handling failed:', err);
    return true;
  }
}
