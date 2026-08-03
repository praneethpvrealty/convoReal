// ============================================================
// Location reveal requests — the consent machinery behind the
// property location guard.
//
// A DIRECT request (no share attribution) goes straight to the
// listing side's queue, exactly like document requests.
//
// A request that arrived through a shared link (co-broker
// attribution via ?v=<contactId> / ?s=<shareId>) walks a consent
// chain instead: each intermediary between the seeker and the
// listing owner is asked on WhatsApp — with the seeker's identity
// MASKED — and only after the intermediary closest to the owner
// has consented does the request reach the owner's queue for the
// final approve/reject. The seeker's name and phone never reach
// the listing side in the clear, and no Engine contact is created
// for them: a co-broker's client must not be poachable through
// their own location request. Chains deeper than one hop are
// recorded in property_reshare_links (migration 176): a co-broker
// holding a forwarded link mints their OWN attributed link, and a
// request walks contact → parent → … until the hop whose parent
// is the listing side, then lands in the owner's queue.
//
// Rejection, owner rejection, or a 2-hour consent timeout all end
// the same way: the seeker is politely redirected to the person
// who shared them the property.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  normalizePhoneWithCountryCode,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils';
import { maskName, maskPhone } from '@/lib/inventory/location-guard';

export const CONSENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const REVEAL_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export const CONSENT_APPROVE_PREFIX = 'locreq_approve:';
export const CONSENT_DECLINE_PREFIX = 'locreq_decline:';

export interface LocationRequestRow {
  id: string;
  account_id: string;
  property_id: string;
  requester_name: string;
  requester_phone: string;
  status: string;
  via_share_id: string | null;
  via_contact_id: string | null;
  consent_chain: Array<{ contact_id: string; decision: string; at: string }>;
  pending_consent_contact_id: string | null;
  consent_requested_at: string | null;
  share_token: string | null;
}

export function mintRevealToken(): { token: string; expiresAt: string } {
  const raw =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  return {
    token: raw.substring(0, 48),
    expiresAt: new Date(Date.now() + REVEAL_TOKEN_TTL_MS).toISOString(),
  };
}

export function revealBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://app.convoreal.com'
  ).replace(/\/+$/, '');
}

/** The diplomatic consent ask sent to an intermediary. Emphasises that
 *  the seeker's details stay private and that the SYSTEM delivers the
 *  reveal — the intermediary is never exposed as the sender, and the
 *  listing office never sees the client. */
export function buildConsentMessage(args: {
  coBrokerName: string;
  propertyTitle: string;
  requesterName: string;
  requesterPhone: string;
}): string {
  return (
    `🤝 Hi ${args.coBrokerName},\n\n` +
    `Someone you shared *${args.propertyTitle}* with — *${maskName(args.requesterName)}* (${maskPhone(args.requesterPhone)}) — ` +
    `has asked for the exact location and photos of the property.\n\n` +
    `Their contact details stay fully private: they are not shared with the listing office or anyone else, ` +
    `and if approved, ConvoReal sends them the details directly on your behalf — the message never comes from you personally.\n\n` +
    `Would you like to approve this request?`
  );
}

/** Sent to the seeker on rejection or timeout at ANY stage. */
export function buildSeekerRedirectMessage(propertyTitle: string): string {
  return (
    `Hi, thank you for your interest in *${propertyTitle}*.\n\n` +
    `You can speak with the person who shared you the property details — ` +
    `they will help you with more details so you can make an informed decision.`
  );
}

export function buildRevealMessage(args: {
  requesterName: string;
  propertyTitle: string;
  revealLink: string;
}): string {
  return (
    `📍 *Exact Location — ${args.propertyTitle}*\n\n` +
    `Hi ${args.requesterName}, your location request was approved.\n\n` +
    `🗺 Address, map pin & full photos: ${args.revealLink}\n\n` +
    `⏳ This link is valid for 48 hours.`
  );
}

/** Heads-up to the intermediary when their client received the reveal. */
export function buildCoBrokerRevealNotice(propertyTitle: string): string {
  return (
    `✅ The location request for *${propertyTitle}* was approved — ` +
    `ConvoReal has sent the exact location and photos directly to the requester. ` +
    `Their details remain private.`
  );
}

export function parseConsentReply(
  replyId: string
): { requestId: string; decision: 'approve' | 'decline' } | null {
  if (replyId.startsWith(CONSENT_APPROVE_PREFIX)) {
    return {
      requestId: replyId.slice(CONSENT_APPROVE_PREFIX.length),
      decision: 'approve',
    };
  }
  if (replyId.startsWith(CONSENT_DECLINE_PREFIX)) {
    return {
      requestId: replyId.slice(CONSENT_DECLINE_PREFIX.length),
      decision: 'decline',
    };
  }
  return null;
}

async function propertyTitle(
  admin: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<string> {
  const { data } = await admin
    .from('properties')
    .select('title')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as { title?: string } | null)?.title || 'the property';
}

async function sendToSeeker(
  accountId: string,
  requesterPhone: string,
  text: string
): Promise<void> {
  const phone = normalizePhoneWithCountryCode(requesterPhone);
  if (!phone) return;
  try {
    await sendWhatsAppMessageAndPersist({
      accountId,
      toPhone: phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });
  } catch (err) {
    console.error('[location-requests] Seeker send failed:', err);
  }
}

/**
 * Asks the given intermediary contact for consent with interactive
 * Approve / Decline buttons, stamping the pending-hop fields. Returns
 * false when the contact has no reachable phone (callers fall back to
 * the owner queue rather than stranding the request).
 */
export async function requestConsentFromContact(
  admin: SupabaseClient,
  request: Pick<
    LocationRequestRow,
    'id' | 'account_id' | 'property_id' | 'requester_name' | 'requester_phone'
  >,
  contactId: string
): Promise<boolean> {
  const { data: contact } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .eq('account_id', request.account_id)
    .maybeSingle();

  const phone = contact?.phone
    ? normalizePhoneWithCountryCode(contact.phone)
    : null;
  if (!contact || !phone) return false;

  const title = await propertyTitle(
    admin,
    request.account_id,
    request.property_id
  );

  try {
    await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      contactId: contact.id,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'buttons',
      interactiveBody: buildConsentMessage({
        coBrokerName: contact.name || 'there',
        propertyTitle: title,
        requesterName: request.requester_name,
        requesterPhone: request.requester_phone,
      }),
      interactiveButtons: [
        { id: `${CONSENT_APPROVE_PREFIX}${request.id}`, title: '✅ Approve' },
        { id: `${CONSENT_DECLINE_PREFIX}${request.id}`, title: '❌ Decline' },
      ],
    });
  } catch (err) {
    console.error('[location-requests] Consent send failed:', err);
    return false;
  }

  await admin
    .from('property_location_requests')
    .update({
      pending_consent_contact_id: contactId,
      consent_requested_at: new Date().toISOString(),
    })
    .eq('id', request.id);

  return true;
}

/** Notifies the listing side that a request awaits their decision. */
export async function notifyOwnerQueue(
  admin: SupabaseClient,
  request: Pick<
    LocationRequestRow,
    | 'id'
    | 'account_id'
    | 'property_id'
    | 'requester_name'
    | 'requester_phone'
    | 'via_contact_id'
  >
): Promise<void> {
  const { data: property } = await admin
    .from('properties')
    .select('id, title, property_code, user_id')
    .eq('id', request.property_id)
    .eq('account_id', request.account_id)
    .maybeSingle();
  if (!property) return;

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', request.account_id)
    .maybeSingle();
  const targetUserId = property.user_id || account?.owner_user_id || null;
  if (!targetUserId) return;

  // Attributed requests keep the seeker masked from the listing side.
  const attributed = Boolean(request.via_contact_id);
  const fromLine = attributed
    ? `From: ${maskName(request.requester_name)} · ${maskPhone(request.requester_phone)} (via a co-broker share — identity protected)`
    : `From: ${request.requester_name} · ${request.requester_phone}`;

  try {
    const { data: agentProfile } = await admin
      .from('profiles')
      .select('email')
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!agentProfile?.email) return;

    const { data: agentContact } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('account_id', request.account_id)
      .eq('email', agentProfile.email)
      .maybeSingle();
    if (!agentContact?.phone) return;

    await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      userId: targetUserId,
      contactId: agentContact.id,
      kind: 'text',
      senderType: 'bot',
      text:
        `📍 *New Location Reveal Request*\n` +
        `Property: ${property.title}${property.property_code ? ` (${property.property_code})` : ''}\n` +
        `${fromLine}\n\n` +
        `Open the property in your Engine dashboard to Approve or Reject.`,
    });
  } catch (err) {
    console.error('[location-requests] Owner notify failed:', err);
  }
}

/**
 * Mints the token, stamps the row approved, sends the reveal link to
 * the seeker and — for attributed requests — the private heads-up to
 * the intermediary. Used by both the owner PATCH route and (through
 * the owner queue) never by consent replies directly: intermediary
 * consent forwards to the owner queue, it does not reveal.
 */
export async function approveRequestAndSendReveal(
  admin: SupabaseClient,
  request: LocationRequestRow,
  approvedByUserId: string | null
): Promise<{ shareLink: string }> {
  const { token, expiresAt } = mintRevealToken();
  const shareLink = `${revealBaseUrl()}/reveal/${token}`;

  await admin
    .from('property_location_requests')
    .update({
      status: 'approved',
      share_token: token,
      share_token_expires_at: expiresAt,
      approved_by: approvedByUserId,
      approved_at: new Date().toISOString(),
      pending_consent_contact_id: null,
      consent_requested_at: null,
    })
    .eq('id', request.id);

  const title = await propertyTitle(
    admin,
    request.account_id,
    request.property_id
  );
  await sendToSeeker(
    request.account_id,
    request.requester_phone,
    buildRevealMessage({
      requesterName: request.requester_name,
      propertyTitle: title,
      revealLink: shareLink,
    })
  );
  await admin
    .from('property_location_requests')
    .update({ share_sent_at: new Date().toISOString() })
    .eq('id', request.id);

  if (request.via_contact_id) {
    try {
      await sendWhatsAppMessageAndPersist({
        accountId: request.account_id,
        contactId: request.via_contact_id,
        kind: 'text',
        senderType: 'bot',
        text: buildCoBrokerRevealNotice(title),
      });
    } catch (err) {
      console.error('[location-requests] Co-broker notice failed:', err);
    }
  }

  return { shareLink };
}

/** Ends the request (rejected/expired) and redirects the seeker. */
export async function closeRequestWithRedirect(
  admin: SupabaseClient,
  request: Pick<
    LocationRequestRow,
    'id' | 'account_id' | 'property_id' | 'requester_phone'
  >,
  status: 'rejected' | 'expired'
): Promise<void> {
  await admin
    .from('property_location_requests')
    .update({
      status,
      pending_consent_contact_id: null,
      consent_requested_at: null,
    })
    .eq('id', request.id);

  const title = await propertyTitle(
    admin,
    request.account_id,
    request.property_id
  );
  await sendToSeeker(
    request.account_id,
    request.requester_phone,
    buildSeekerRedirectMessage(title)
  );
}

/**
 * Handles an inbound interactive button reply that targets a consent
 * ask. Returns true when the reply was a consent decision and is fully
 * handled (the caller must stop normal chatbot processing).
 */
export async function handleLocationConsentReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const parsed = parseConsentReply(args.replyId);
  if (!parsed) return false;

  const { data } = await args.admin
    .from('property_location_requests')
    .select('*')
    .eq('id', parsed.requestId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  const request = data as LocationRequestRow | null;
  if (!request) return true;
  if (request.status !== 'pending' || !request.pending_consent_contact_id)
    return true;

  // Only the intermediary the ask was sent to may answer it — a
  // forwarded consent message tapped by someone else is not consent.
  const { data: pendingContact } = await args.admin
    .from('contacts')
    .select('id, phone')
    .eq('id', request.pending_consent_contact_id)
    .eq('account_id', args.accountId)
    .maybeSingle();
  if (
    !pendingContact?.phone ||
    !phonesMatch(pendingContact.phone, args.senderPhone)
  ) {
    return true;
  }

  const chain = Array.isArray(request.consent_chain)
    ? request.consent_chain
    : [];
  const hop = {
    contact_id: request.pending_consent_contact_id,
    decision: parsed.decision === 'approve' ? 'approved' : 'declined',
    at: new Date().toISOString(),
  };

  if (parsed.decision === 'decline') {
    await args.admin
      .from('property_location_requests')
      .update({ consent_chain: [...chain, hop] })
      .eq('id', request.id);
    await closeRequestWithRedirect(args.admin, request, 'rejected');
    await ackConsentContact(args.admin, request, 'declined');
    return true;
  }

  // Approved: walk one level up the recorded sharing chain. When there
  // is no further intermediary — the hop next to the listing side — the
  // request lands in the owner's queue for the final decision.
  const nextChain = [...chain, hop];
  const nextIntermediary = await resolveNextIntermediary(
    args.admin,
    request,
    request.pending_consent_contact_id,
    nextChain
  );

  await args.admin
    .from('property_location_requests')
    .update({
      consent_chain: nextChain,
      pending_consent_contact_id: null,
      consent_requested_at: null,
    })
    .eq('id', request.id);

  if (nextIntermediary) {
    const asked = await requestConsentFromContact(
      args.admin,
      request,
      nextIntermediary
    );
    if (asked) {
      await ackConsentContact(args.admin, request, 'approved', 'intermediary');
      return true;
    }
    // Unreachable next hop: fail open to the owner queue rather than
    // stranding the request.
  }

  await notifyOwnerQueue(args.admin, request);
  await ackConsentContact(args.admin, request, 'approved', 'owner');
  return true;
}

/** Depth cap for chain walking — a backstop against pathological or
 *  cyclic reshare data, far above any real co-broking chain. */
const MAX_CONSENT_HOPS = 5;

/**
 * The next intermediary above `contactId` in the property's recorded
 * sharing chain (property_reshare_links), or null when the contact was
 * shared to directly by the listing side, the chain is exhausted, or
 * the parent already appears in the consent chain (cycle guard).
 */
export async function resolveNextIntermediary(
  admin: SupabaseClient,
  request: Pick<LocationRequestRow, 'account_id' | 'property_id'>,
  contactId: string,
  consentChain: Array<{ contact_id: string }>
): Promise<string | null> {
  if (consentChain.length >= MAX_CONSENT_HOPS) return null;

  const { data: reshare } = await admin
    .from('property_reshare_links')
    .select('parent_contact_id')
    .eq('account_id', request.account_id)
    .eq('property_id', request.property_id)
    .eq('contact_id', contactId)
    .maybeSingle();

  const parentId = reshare?.parent_contact_id ?? null;
  if (!parentId) return null;
  if (consentChain.some((h) => h.contact_id === parentId)) return null;

  const { data: parent } = await admin
    .from('contacts')
    .select('id')
    .eq('id', parentId)
    .eq('account_id', request.account_id)
    .maybeSingle();
  return parent?.id ?? null;
}

async function ackConsentContact(
  admin: SupabaseClient,
  request: LocationRequestRow,
  decision: 'approved' | 'declined',
  forwardedTo: 'owner' | 'intermediary' = 'owner'
): Promise<void> {
  if (!request.pending_consent_contact_id) return;
  const title = await propertyTitle(
    admin,
    request.account_id,
    request.property_id
  );
  const text =
    decision === 'approved'
      ? forwardedTo === 'intermediary'
        ? `👍 Noted — the request for *${title}* has been forwarded to the agent who shared the property with you for their consent. The requester's details remain private.`
        : `👍 Noted — the request for *${title}* has been forwarded to the listing side for final approval. The requester's details remain private.`
      : `👍 Noted — the request for *${title}* has been declined. The requester has been advised to reach out to you for more details.`;
  try {
    await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      contactId: request.pending_consent_contact_id,
      kind: 'text',
      senderType: 'bot',
      text,
    });
  } catch (err) {
    console.error('[location-requests] Consent ack failed:', err);
  }
}

/**
 * Expires consent asks older than 2 hours. Each expired request ends
 * with the seeker redirect. Returns the number of requests expired.
 */
export async function sweepConsentTimeouts(
  admin: SupabaseClient
): Promise<number> {
  const cutoff = new Date(Date.now() - CONSENT_TIMEOUT_MS).toISOString();
  const { data } = await admin
    .from('property_location_requests')
    .select(
      'id, account_id, property_id, requester_phone, consent_chain, pending_consent_contact_id'
    )
    .eq('status', 'pending')
    .not('pending_consent_contact_id', 'is', null)
    .lt('consent_requested_at', cutoff)
    .limit(50);

  const rows = (data || []) as Array<
    Pick<
      LocationRequestRow,
      | 'id'
      | 'account_id'
      | 'property_id'
      | 'requester_phone'
      | 'consent_chain'
      | 'pending_consent_contact_id'
    >
  >;

  for (const row of rows) {
    const chain = Array.isArray(row.consent_chain) ? row.consent_chain : [];
    await admin
      .from('property_location_requests')
      .update({
        consent_chain: [
          ...chain,
          {
            contact_id: row.pending_consent_contact_id,
            decision: 'timed_out',
            at: new Date().toISOString(),
          },
        ],
      })
      .eq('id', row.id);
    await closeRequestWithRedirect(admin, row, 'expired');
  }

  return rows.length;
}

// ── Re-share links ──────────────────────────────────────────────
// A co-broker holding a forwarded link mints their own attributed
// link so onward forwarding stays visible to the consent chain.

/** True when the contact is a recorded re-sharer of this property —
 *  which makes them a consent-chain intermediary regardless of their
 *  Engine classification. */
export async function hasReshareLink(
  admin: SupabaseClient,
  accountId: string,
  propertyId: string,
  contactId: string
): Promise<boolean> {
  const { data } = await admin
    .from('property_reshare_links')
    .select('id')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .eq('contact_id', contactId)
    .maybeSingle();
  return Boolean(data);
}

/** The personalized forwardable showcase link for a re-sharer. */
export function buildReshareUrl(args: {
  propertyIdOrCode: string;
  contactId: string;
}): string {
  return `${revealBaseUrl()}/?property_id=${encodeURIComponent(args.propertyIdOrCode)}&mode=view&v=${encodeURIComponent(args.contactId)}`;
}

/** WhatsApp message delivering a re-sharer their personal link — they
 *  forward it onward from their own chat. */
export function buildReshareLinkMessage(args: {
  name: string;
  propertyTitle: string;
  link: string;
}): string {
  return (
    `🔗 Hi ${args.name}, here is your personal share link for *${args.propertyTitle}*:\n\n` +
    `${args.link}\n\n` +
    `Forward this link when you share the property onward. Location requests coming ` +
    `through it will reach you first for your consent — and the requester's details ` +
    `stay private to you.`
  );
}

/**
 * Records `contactId` as a re-sharer of the property under
 * `parentContactId` (NULL = shared to them by the listing side).
 * First recorded parent wins — a later mint must not rewire an
 * existing chain out from under earlier requests.
 */
export async function recordReshareLink(
  admin: SupabaseClient,
  args: {
    accountId: string;
    propertyId: string;
    contactId: string;
    parentContactId: string | null;
  }
): Promise<void> {
  const { data: existing } = await admin
    .from('property_reshare_links')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('property_id', args.propertyId)
    .eq('contact_id', args.contactId)
    .maybeSingle();
  if (existing) return;

  const { error } = await admin.from('property_reshare_links').insert({
    account_id: args.accountId,
    property_id: args.propertyId,
    contact_id: args.contactId,
    parent_contact_id: args.parentContactId,
  });
  if (error && error.code !== '23505') {
    console.error('[location-requests] Reshare insert failed:', error);
  }
}
