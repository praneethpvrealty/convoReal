// Drop-off feedback on a shared property.
//
// "Close my enquiry" on the check-in and enquiry templates closes the
// enquiry on the listing the template named — and until now learned
// nothing about *why* that listing lost them. The tap opened a 24-hour
// window, so the acknowledgement is followed by one tap-to-answer list
// naming the property; the answer lands on listing_feedback (which
// rankings and the share summary read), the contact's timeline, and
// the journey item for that contact×property pair, so web and mobile
// both show it without a surface of their own.
//
// Closing one listing is not closing the search, so the thank-you
// hands over to the enquiry review (the lead's other open enquiries,
// each closable with a tap) and then the requirement ladder. Only
// "bought elsewhere" and "not buying right now" end the search: either
// answer marks the contact dead (START ALERTS revives), and its
// thank-you is the last message.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';
import {
  scanMessagesForProperties,
  type ScannableMessage,
  type ScannableProperty,
} from '@/lib/journey/chat-scan';
import { createNotification } from '@/lib/notifications/create';
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { markContactDead } from '@/lib/contacts/lifecycle';
import { continueAfterEnquiryClose } from '@/lib/whatsapp/enquiry-review';

export const ENQUIRY_DROPOFF_ID_PREFIX = 'lfbd_';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHARE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_OUTBOUND_LIMIT = 10;

export const DROPOFF_REASONS = [
  'budget',
  'location',
  'type',
  'size',
  'bought_elsewhere',
  'not_now',
  'other',
] as const;
export type DropoffReason = (typeof DROPOFF_REASONS)[number];

/** Meta caps list row titles at 24 characters. */
export const DROPOFF_REASON_ROWS: { reason: DropoffReason; title: string }[] = [
  { reason: 'budget', title: 'Budget too high' },
  { reason: 'location', title: 'Wrong location' },
  { reason: 'type', title: 'Wrong property type' },
  { reason: 'size', title: "Size didn't work" },
  { reason: 'bought_elsewhere', title: 'Bought elsewhere' },
  { reason: 'not_now', title: 'Not buying right now' },
  { reason: 'other', title: 'Something else' },
];

const REASON_THANKS: Record<DropoffReason, string> = {
  budget: 'Thank you — that helps us do better.',
  location: 'Thank you — that helps us do better.',
  type: 'Thank you — that helps us do better.',
  size: 'Thank you — that helps us do better.',
  bought_elsewhere:
    'Thank you, and congratulations on your new property! We wish you the very best.',
  not_now:
    'Thank you — understood. Whenever you are ready to look again, just reply START ALERTS and we will pick up from there.',
  other:
    'Thank you — noted. If you would like, reply with a line on what did not fit; it goes straight to our team.',
};

/** What the thank-you hands over to. 'sorted' runs the enquiry review
 *  and then the requirement ladder; 'review' stops at the review, since
 *  the thank-you already asked for a typed reply; 'done' ends there —
 *  the lead is not looking, or not looking now, and either answer
 *  parks the search (dead, so matching and alerts stop) until they
 *  reply START ALERTS. */
const REASON_NEXT: Record<DropoffReason, 'sorted' | 'review' | 'done'> = {
  budget: 'sorted',
  location: 'sorted',
  type: 'sorted',
  size: 'sorted',
  bought_elsewhere: 'done',
  not_now: 'done',
  other: 'review',
};

export interface DroppedProperty {
  id: string;
  title: string | null;
  property_code?: string | null;
}

function labelFor(p: DroppedProperty): string {
  const title = (p.title || '').trim();
  const code = (p.property_code || '').trim();
  if (title && code) return `${title} (${code})`;
  return title || code || 'the property';
}

function reasonTitle(reason: DropoffReason): string {
  return DROPOFF_REASON_ROWS.find((r) => r.reason === reason)?.title ?? reason;
}

/**
 * Which shared property the close was about, strongest signal first:
 * the quoted template the lead tapped, then the thread's recent
 * outbound messages, then the contact's recorded enquiry. Null when
 * nothing names a listing — a requirement-level close has no property
 * to ask about.
 */
export async function resolveDroppedProperty(args: {
  db: SupabaseClient;
  accountId: string;
  contact: { id: string; last_inquired_property_id?: string | null };
  conversationId: string;
  contextMessageId: string | null;
}): Promise<DroppedProperty | null> {
  const { db, accountId, contact, conversationId, contextMessageId } = args;

  const { data: propData } = await db
    .from('properties')
    .select('id, title, property_code')
    .eq('account_id', accountId);
  const properties = ((propData ?? []) as DroppedProperty[]).filter(
    (p): p is DroppedProperty & ScannableProperty => Boolean(p.title)
  );
  if (properties.length === 0) return null;

  const pick = (messages: ScannableMessage[]): DroppedProperty | null => {
    const found = scanMessagesForProperties(messages, properties);
    const id = found.keys().next().value as string | undefined;
    return properties.find((p) => p.id === id) ?? null;
  };

  if (contextMessageId) {
    const { data: quoted } = await db
      .from('messages')
      .select('content_text, created_at')
      .eq('account_id', accountId)
      .eq('message_id', contextMessageId)
      .maybeSingle();
    if (quoted) {
      const fromQuoted = pick([quoted as ScannableMessage]);
      if (fromQuoted) return fromQuoted;
    }
  }

  const { data: outbound } = await db
    .from('messages')
    .select('content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .gte('created_at', new Date(Date.now() - SHARE_LOOKBACK_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(RECENT_OUTBOUND_LIMIT);
  const fromThread = pick((outbound ?? []) as ScannableMessage[]);
  if (fromThread) return fromThread;

  if (contact.last_inquired_property_id) {
    return (
      properties.find((p) => p.id === contact.last_inquired_property_id) ?? null
    );
  }
  return null;
}

export function buildEnquiryDropoffBody(property: DroppedProperty): string {
  return `Quick one — what made you drop *${labelFor(property)}*? One tap tells us what did not fit.`;
}

export function buildEnquiryDropoffSections(
  propertyId: string
): InteractiveListSection[] {
  return [
    {
      rows: DROPOFF_REASON_ROWS.map((r) => ({
        id: `${ENQUIRY_DROPOFF_ID_PREFIX}${r.reason}_${propertyId}`,
        title: r.title,
      })),
    },
  ];
}

/**
 * Asks why the closed listing did not fit. Never throws — the
 * acknowledgement already landed, and this must not undo that.
 */
export async function sendEnquiryDropoffPrompt(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  property: DroppedProperty;
}): Promise<boolean> {
  const { db, accountId, userId, contactId, conversationId, property } = args;
  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId,
      conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody: buildEnquiryDropoffBody(property),
      interactiveButtonLabel: 'Tell us why',
      interactiveSections: buildEnquiryDropoffSections(property.id),
      allowDeadContact: true,
      customDbClient: db,
    });
    return result.success;
  } catch (err) {
    console.error('[enquiry-dropoff] prompt send failed:', err);
    return false;
  }
}

/** Ids arrive from the webhook, so nothing embedded is trusted. */
export function parseEnquiryDropoffReply(
  replyId: string
): { reason: DropoffReason; propertyId: string } | null {
  if (!replyId.startsWith(ENQUIRY_DROPOFF_ID_PREFIX)) return null;
  const rest = replyId.slice(ENQUIRY_DROPOFF_ID_PREFIX.length);
  const sep = rest.lastIndexOf('_');
  if (sep === -1) return null;
  const reason = rest.slice(0, sep) as DropoffReason;
  const propertyId = rest.slice(sep + 1);
  if (!DROPOFF_REASONS.includes(reason) || !UUID_RE.test(propertyId))
    return null;
  return { reason, propertyId };
}

/**
 * Routes a tapped lfbd_* reply. Returns true when the tap was consumed;
 * false for ids this module does not own or a property outside the
 * account.
 */
export async function handleEnquiryDropoffReason(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: { id: string; name?: string | null };
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const { db, accountId, configOwnerUserId, contact, conversationId } = args;
  const parsed = parseEnquiryDropoffReply(args.replyId);
  if (!parsed) return false;

  try {
    const { data: property } = await db
      .from('properties')
      .select('id, title, property_code, user_id')
      .eq('id', parsed.propertyId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!property) return false;

    const label = labelFor(property as DroppedProperty);
    const title = reasonTitle(parsed.reason);
    const name = leadFirstName(contact.name) || 'The lead';

    await db.from('listing_feedback').upsert(
      {
        account_id: accountId,
        contact_id: contact.id,
        property_id: property.id as string,
        verdict: 'rejected',
        reason: parsed.reason,
      },
      { onConflict: 'contact_id,property_id' }
    );

    await db.from('contact_notes').insert({
      contact_id: contact.id,
      account_id: accountId,
      user_id: null,
      note_text: `🚪 ${name} dropped ${label}: ${title}`,
    });

    // The close already dropped this branch, so the pair is matched
    // whatever its status — the reason belongs on the dropped item.
    const { data: item } = await db
      .from('journey_items')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('property_id', property.id as string)
      .maybeSingle();
    if (item) {
      await db.from('journey_events').insert({
        account_id: accountId,
        item_id: (item as { id: string }).id,
        event_type: 'client_response',
        reason: `Closed enquiry — ${title}`,
      });
      await db
        .from('journey_items')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', (item as { id: string }).id);
    }

    const { data: contactRow } = await db
      .from('contacts')
      .select('assigned_agent_id')
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .maybeSingle();

    await createNotification({
      accountId,
      userId:
        (contactRow?.assigned_agent_id as string | null) ??
        (property as { user_id?: string | null }).user_id ??
        configOwnerUserId,
      type: 'new_message',
      title: `🚪 ${name} dropped ${label}`,
      body: `Reason given: ${title}.`,
      entityType: 'contact',
      entityId: contact.id,
      link: `/journey?contact=${contact.id}`,
      channels: { inApp: true, push: true, whatsapp: false },
    });

    if (parsed.reason === 'bought_elsewhere' || parsed.reason === 'not_now') {
      await markContactDead({
        db,
        accountId,
        contactId: contact.id,
        reason: 'closed_enquiry',
        note:
          parsed.reason === 'bought_elsewhere'
            ? `🏠 ${name} bought elsewhere — closed from WhatsApp`
            : `⏸ ${name} is not buying right now — closed from WhatsApp`,
      });
    }

    const thanks = REASON_THANKS[parsed.reason];
    const next = REASON_NEXT[parsed.reason];
    if (next !== 'done') {
      const continued = await continueAfterEnquiryClose({
        db,
        accountId,
        userId: configOwnerUserId,
        contactId: contact.id,
        conversationId,
        acknowledgement: thanks,
        reviewOnly: next === 'review',
      });
      if (continued !== 'none') return true;
    }

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contact.id,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text: thanks,
      allowDeadContact: true,
      customDbClient: db,
    });
    return true;
  } catch (err) {
    console.error('[enquiry-dropoff] reason handling failed:', err);
    return true;
  }
}
