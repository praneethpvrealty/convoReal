// ============================================================
// "Hi! I am interested in your property … (Property ID: PROP-1030)"
//
// A buyer tapping Enquire on the showcase sends that sentence, and the
// agent got it as what it literally is: a line of text, in a thread,
// with a generic "New lead just messaged you" ping. Compare the listing
// access request, which arrives as a card naming the property and the
// requester with Approve/Reject under it — the agent acts without
// leaving WhatsApp and without deciding what to type.
//
// The enquiry has strictly MORE to go on: the webhook has already
// matched the property code and pinned the listing to the contact. This
// builds the same shape of card for it, with the two things a buyer who
// just asked for details actually wants, and a third for "leave it, I
// will answer" — because an agent mid-negotiation must be able to
// decline to have the bot speak for them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
// The same resolver the listing-access card uses. An agent is a
// profile, not a contact, and finding the WhatsApp number behind one
// took three attempts to get right — see its own comment. Reused
// rather than rewritten so both cards reach the same person.
import { resolveOwnerWhatsAppContact } from '@/lib/inventory/location-requests';

export const ENQUIRY_APPROVE_PREFIX = 'enq_approve:';
export const ENQUIRY_REJECT_PREFIX = 'enq_reject:';
// The first card shipped with these three; kept parseable so a card
// already sitting in an agent's WhatsApp still works when tapped.
export const ENQUIRY_PHOTOS_PREFIX = 'enq_photos:';
export const ENQUIRY_DETAILS_PREFIX = 'enq_details:';
export const ENQUIRY_MINE_PREFIX = 'enq_mine:';

export interface EnquiryAction {
  action: 'approve' | 'reject' | 'photos' | 'details' | 'mine';
  propertyId: string;
  contactId: string;
}

/** Both ids ride in the button, because the card is delivered to the
 *  AGENT's thread and every action operates on the BUYER's. Nothing
 *  else in the agent's conversation says which lead is meant. */
function encode(prefix: string, propertyId: string, contactId: string): string {
  return `${prefix}${propertyId}:${contactId}`;
}

export function parseEnquiryReply(
  replyId: string | null | undefined
): EnquiryAction | null {
  const id = (replyId || '').trim();
  const prefixes = [
    [ENQUIRY_APPROVE_PREFIX, 'approve'],
    [ENQUIRY_REJECT_PREFIX, 'reject'],
    [ENQUIRY_PHOTOS_PREFIX, 'photos'],
    [ENQUIRY_DETAILS_PREFIX, 'details'],
    [ENQUIRY_MINE_PREFIX, 'mine'],
  ] as const;

  for (const [prefix, action] of prefixes) {
    if (!id.startsWith(prefix)) continue;
    const [propertyId, contactId] = id.slice(prefix.length).split(':');
    if (!propertyId || !contactId) return null;
    return { action, propertyId, contactId };
  }
  return null;
}

export interface EnquiryCardProperty {
  title?: string | null;
  property_code?: string | null;
  price?: number | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
}

function inr(amount?: number | null): string {
  if (!amount || !Number.isFinite(amount)) return '';
  if (amount >= 10000000)
    return `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (amount >= 100000)
    return `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * The card's text. Leads with the listing, because that is the thing
 * the agent has to recognise before any button means anything.
 */
export function buildEnquiryCardBody(
  property: EnquiryCardProperty,
  leadName: string,
  leadPhone: string,
  enquiryText: string
): string {
  const label = [
    property.title,
    property.property_code && `(${property.property_code})`,
  ]
    .filter(Boolean)
    .join(' ');
  const where = [property.sublocality, property.city]
    .filter(Boolean)
    .join(', ');
  const price = inr(property.price);

  return [
    '🔔 *New Property Enquiry*',
    `Property: ${label || 'a listing'}`,
    ...(where || price ? [[price, where].filter(Boolean).join(' · ')] : []),
    `From: ${leadName} · ${leadPhone}`,
    '',
    `"${enquiryText.slice(0, 160)}"`,
    '',
    "Approve to send them the complete details — photo, price, specs and the listing link — on WhatsApp. Reject to point them to your team's direct number instead; the thread is yours in the inbox.",
  ].join('\n');
}

/**
 * What the buyer hears the moment they enquire. A promise, not the
 * details: the details are the agent's to release, and this is what
 * replaced the ladder asking "what budget range are you working with?"
 * of a buyer who had just named the exact listing.
 */
export function buildEnquiryAckText(
  leadName: string | null | undefined,
  title: string | null | undefined
): string {
  const first = (leadName || '').trim().split(/\s+/)[0];
  const greeting = first ? `Thanks ${first}!` : 'Thanks!';
  const subject = title ? `*${title}*` : 'that property';
  return `${greeting} Your enquiry for ${subject} has reached our team — you'll receive the complete details right here shortly.`;
}

/**
 * What the buyer hears when the agent taps Reject. The ack promised
 * them the details "shortly" — going silent breaks that promise, so
 * the bot closes its side by pointing them at the team's own number.
 */
export function buildEnquiryRejectText(
  leadName: string | null | undefined,
  title: string | null | undefined,
  teamPhone: string | null | undefined
): string {
  const first = (leadName || '').trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first}!` : 'Hi!';
  const subject = title ? `*${title}*` : 'that property';
  const reach = teamPhone
    ? `please speak with our team directly on ${teamPhone}`
    : 'our team will reach out to you directly';
  return `${greeting} Thanks for your enquiry about ${subject}. For the details on this one, ${reach} — they'll help you personally.`;
}

/**
 * The number a rejected buyer is pointed to: the contact number the
 * brokerage publishes on its showcase, falling back to the routed
 * agent's own WhatsApp when none is set.
 */
export async function resolveEnquiryTeamPhone(
  db: SupabaseClient,
  accountId: string,
  agentUserId: string
): Promise<string | null> {
  const { data } = await db
    .from('showcase_settings')
    .select('contact_phone')
    .eq('account_id', accountId)
    .maybeSingle();
  const configured = ((data?.contact_phone as string) || '').trim();
  if (configured) return configured;
  const agent = await resolveOwnerWhatsAppContact(db, accountId, agentUserId);
  return agent?.phone || null;
}

export interface SendEnquiryCardArgs {
  db: SupabaseClient;
  accountId: string;
  /** The agent this lead is routed to — the card's recipient. */
  agentUserId: string;
  propertyId: string;
  /** The lead: whose thread the buttons act on. */
  contactId: string;
  leadName: string;
  leadPhone: string;
  enquiryText: string;
}

/**
 * Sends the card to the routed agent. Returns false when the listing
 * cannot be loaded or the send fails, so the caller falls back to the
 * plain new-lead ping rather than leaving the agent with nothing.
 */
export async function sendPropertyEnquiryCard(
  args: SendEnquiryCardArgs
): Promise<boolean> {
  const { db, accountId, agentUserId, propertyId, contactId } = args;

  try {
    const { data: property } = await db
      .from('properties')
      .select('title, property_code, price, location, sublocality, city')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!property) return false;

    const agent = await resolveOwnerWhatsAppContact(db, accountId, agentUserId);
    if (!agent) return false;

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: agentUserId,
      ...(agent.contactId
        ? { contactId: agent.contactId }
        : { toPhone: agent.phone }),
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'buttons',
      interactiveBody: buildEnquiryCardBody(
        property as EnquiryCardProperty,
        args.leadName,
        args.leadPhone,
        args.enquiryText
      ),
      interactiveButtons: [
        {
          id: encode(ENQUIRY_APPROVE_PREFIX, propertyId, contactId),
          title: '✅ Approve',
        },
        {
          id: encode(ENQUIRY_REJECT_PREFIX, propertyId, contactId),
          title: '❌ Reject',
        },
      ],
    });

    return result.success;
  } catch (err) {
    console.error('[enquiry-card] send failed (non-fatal):', err);
    return false;
  }
}
