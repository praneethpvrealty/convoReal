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

export const ENQUIRY_PHOTOS_PREFIX = 'enq_photos:';
export const ENQUIRY_DETAILS_PREFIX = 'enq_details:';
export const ENQUIRY_MINE_PREFIX = 'enq_mine:';

export interface EnquiryAction {
  action: 'photos' | 'details' | 'mine';
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
    'Send the photos or the full details straight to them, or take it yourself and the bot stays out of the way.',
  ].join('\n');
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
          id: encode(ENQUIRY_PHOTOS_PREFIX, propertyId, contactId),
          title: '📸 Send photos',
        },
        {
          id: encode(ENQUIRY_DETAILS_PREFIX, propertyId, contactId),
          title: '📋 Send details',
        },
        {
          id: encode(ENQUIRY_MINE_PREFIX, propertyId, contactId),
          title: "✋ I'll reply",
        },
      ],
    });

    return result.success;
  } catch (err) {
    console.error('[enquiry-card] send failed (non-fatal):', err);
    return false;
  }
}
