import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { generateText } from '@/lib/ai/gemini';
import {
  gatherOwnerDigests,
  buildOwnerDigestMessage,
  buildOwnerDigestSummaryLine,
  digestPeriod,
  hasUpdates,
  type OwnerDigest,
} from '@/lib/owners/owner-digest';

/**
 * Contextual replies to PROPERTY OWNERS on WhatsApp.
 *
 * Owners get proactive messages about their listings (digest, consent
 * request) and naturally reply with questions — "Which land are you
 * talking about?", "Tell me more". Before this module those replies fell
 * through to the buyer-intake welcome flow ("Let's find your dream
 * property!"), which reads as tone-deaf spam to someone who LISTED a
 * property. The webhook now suppresses buyer-flow entry for owner
 * contacts and routes their free text here instead: a short AI reply
 * grounded ONLY in their own listings and tracked buyer activity, with a
 * deterministic fallback when Gemini is unavailable.
 */

const OWNER_CLASSIFICATIONS = ['Owner', 'Seller', 'Owner & Buyer'];

export interface OwnerishContactFields {
  classification?: string | null;
  owner_digest_consent?: string | null;
  owner_digest_consent_requested_at?: string | null;
}

/**
 * Whether a contact should be treated as a property owner for inbound
 * routing. owner_digest_consent defaults to 'pending' for EVERY contact,
 * so only an explicit granted/declined — or the requested_at stamp the
 * digest engine sets when it messages an owner — counts as a signal.
 */
export function isOwnerContact(contact: OwnerishContactFields): boolean {
  if (
    contact.classification &&
    OWNER_CLASSIFICATIONS.includes(contact.classification)
  ) {
    return true;
  }
  if (
    contact.owner_digest_consent === 'granted' ||
    contact.owner_digest_consent === 'declined'
  ) {
    return true;
  }
  return Boolean(contact.owner_digest_consent_requested_at);
}

export interface OwnedListing {
  id: string;
  title: string;
  property_code: string | null;
  type: string | null;
  status: string | null;
  location: string | null;
  sublocality: string | null;
  city: string | null;
  is_published: boolean | null;
}

export async function findOwnedListings(
  accountId: string,
  contactId: string
): Promise<OwnedListing[]> {
  const { data } = await supabaseAdmin()
    .from('properties')
    .select(
      'id, title, property_code, type, status, location, sublocality, city, is_published'
    )
    .eq('account_id', accountId)
    .eq('owner_contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(10);
  return (data as OwnedListing[]) || [];
}

function listingLocation(listing: OwnedListing): string {
  return (
    [listing.sublocality, listing.city].filter(Boolean).join(', ') ||
    listing.location ||
    ''
  );
}

/** The digest template's "Tell me more" quick reply. */
export function isTellMeMoreText(text: string | null | undefined): boolean {
  return /^tell me more$/i.test((text || '').trim());
}

/** Deterministic reply used when the AI is unavailable — always answers
 *  "which property is this about?" and hands anything else to the agent. */
export function buildOwnerFallbackReply(
  contactName: string | null | undefined,
  listings: OwnedListing[],
  digest: OwnerDigest | null
): string {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const lines = [
    `Hi ${firstName}, this is about ${listings.length === 1 ? 'your listing with us' : 'your listings with us'}:`,
  ];
  for (const listing of listings.slice(0, 3)) {
    const loc = listingLocation(listing);
    lines.push(
      `• *${listing.title}*${listing.property_code ? ` (${listing.property_code})` : ''}${loc ? ` — ${loc}` : ''}`
    );
  }
  if (listings.length > 3) lines.push(`…and ${listings.length - 3} more.`);
  if (digest && hasUpdates(digest)) {
    lines.push('', `This week: ${buildOwnerDigestSummaryLine(digest)}.`);
  }
  lines.push(
    '',
    'Your agent will follow up personally on your message. Reply START UPDATES to get buyer-activity alerts here anytime.'
  );
  return lines.join('\n');
}

const OWNER_REPLY_SYSTEM = [
  'You are the WhatsApp assistant of a real-estate agency, replying to a PROPERTY OWNER who has listed property with the agency.',
  "Reply in under 100 words, warm and professional, in the language of the owner's message (default English).",
  'WhatsApp formatting only: *bold* and "•" bullets — no markdown headers, no links unless given in the facts.',
  'Use ONLY the facts provided. Never invent buyer names, counts, offers, prices or appointments.',
  'If the owner asks which property this is about, name their listing(s).',
  'If the question needs information not in the facts (negotiations, legal, documents, specific buyers), say their agent will follow up personally.',
  'Never treat the owner as a buyer and never offer to find them a property.',
].join(' ');

export function buildOwnerReplyPrompt(
  contactName: string | null | undefined,
  listings: OwnedListing[],
  digest: OwnerDigest | null,
  digestConsent: string | null | undefined,
  ownerMessage: string
): string {
  const listingLines = listings.map((listing) => {
    const loc = listingLocation(listing);
    return `- "${listing.title}"${listing.property_code ? ` (code ${listing.property_code})` : ''}${
      listing.type ? `, ${listing.type}` : ''
    }${loc ? `, ${loc}` : ''}${listing.status ? `, status: ${listing.status}` : ''}${
      listing.is_published ? ', live on our online showcase' : ''
    }`;
  });

  const activityLines: string[] = [];
  if (digest) {
    for (const p of digest.properties) {
      if (
        p.inquiries === 0 &&
        p.shortlisted === 0 &&
        p.visits === 0 &&
        p.views === 0
      )
        continue;
      const bits: string[] = [];
      if (p.inquiries > 0) bits.push(`${p.inquiries} new enquiries`);
      if (p.shortlisted > 0) bits.push(`${p.shortlisted} buyers shortlisted`);
      if (p.visits > 0) bits.push(`${p.visits} site visits scheduled`);
      if (p.views > 0) bits.push(`${p.views} showcase views`);
      activityLines.push(`- "${p.title}": ${bits.join(', ')}`);
    }
  }

  return [
    'FACTS',
    `Owner name: ${contactName?.trim() || 'unknown'}`,
    'Their listings with our agency:',
    ...listingLines,
    'Tracked buyer activity in the last 7 days:',
    ...(activityLines.length > 0
      ? activityLines
      : ['- No fresh tracked activity this week.']),
    `WhatsApp activity-update subscription: ${digestConsent || 'pending'} (they can reply START UPDATES or STOP UPDATES to change it).`,
    '',
    `The owner's WhatsApp message: "${ownerMessage.slice(0, 500)}"`,
    '',
    'Write only the reply message.',
  ].join('\n');
}

export async function handleOwnerInboundMessage(args: {
  accountId: string;
  userId: string;
  contactId: string;
  contactName: string | null;
  conversationId: string;
  digestConsent?: string | null;
  text: string;
  listings: OwnedListing[];
}): Promise<boolean> {
  const text = (args.text || '').trim();
  if (!text || args.listings.length === 0) return false;

  const db = supabaseAdmin();
  let digest: OwnerDigest | null = null;
  try {
    const digests = await gatherOwnerDigests(
      db,
      args.accountId,
      digestPeriod('weekly'),
      [args.contactId]
    );
    digest = digests[0] ? { ...digests[0], name: args.contactName } : null;
  } catch (err) {
    console.error('[owner-reply] activity lookup failed:', err);
  }

  let reply: string;
  if (isTellMeMoreText(text) && digest && hasUpdates(digest)) {
    reply = buildOwnerDigestMessage(digest, 'this week');
  } else {
    try {
      reply = (
        await generateText(
          buildOwnerReplyPrompt(
            args.contactName,
            args.listings,
            digest,
            args.digestConsent,
            text
          ),
          OWNER_REPLY_SYSTEM,
          { tier: 'lite', feature: 'owner_reply' }
        )
      ).trim();
      if (!reply) throw new Error('empty AI reply');
    } catch (err) {
      console.error('[owner-reply] AI reply failed, using fallback:', err);
      reply = buildOwnerFallbackReply(args.contactName, args.listings, digest);
    }
  }

  const res = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text: reply,
  });
  return res.success;
}
