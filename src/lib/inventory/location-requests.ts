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
  loadTemplateForContact,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  LOCATION_REVEAL_TEMPLATE_NAME,
  buildLocationRevealParams,
} from '@/lib/whatsapp/location-reveal-template';
import {
  LOCATION_CONSENT_TEMPLATE_NAME,
  LOCATION_OWNER_DECISION_TEMPLATE_NAME,
  buildLocationConsentParams,
  buildLocationOwnerDecisionParams,
} from '@/lib/whatsapp/location-request-templates';
import {
  normalizePhoneWithCountryCode,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils';
import { maskName, maskPhone } from '@/lib/inventory/location-guard';
import {
  mintShareGrantToken,
  SHARE_GRANT_TTL_MS,
} from '@/lib/inventory/share-grants';
import {
  isTeaserGated,
  teaserTitle,
} from '@/lib/inventory/showcase-visibility';
import { createNotification } from '@/lib/notifications/create';
import { resolveChannels } from '@/lib/notifications/preferences';
import type { MessageTemplate, Property } from '@/types';
import {
  buildRevealDetails,
  buildRevealTemplateFacts,
} from '@/lib/share-message-builder';

export const CONSENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const REVEAL_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export const CONSENT_APPROVE_PREFIX = 'locreq_approve:';
export const CONSENT_DECLINE_PREFIX = 'locreq_decline:';

export const OWNER_APPROVE_PREFIX = 'locreq_owner_approve:';
export const OWNER_REJECT_PREFIX = 'locreq_owner_reject:';

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
  contact_id?: string | null;
  /** What was asked for (migration 254). 'location' is every request
   *  minted before showcase gating existed. */
  scope?: 'location' | 'listing';
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

/** Meta's free-form text limit. A reveal that overruns it is rejected
 *  with an error the template fallback does not recognise as a closed
 *  window, so the seeker would get nothing at all — and the request is
 *  already stamped approved by then. The link is what must survive, so
 *  the details block is what gives way. */
const WHATSAPP_TEXT_LIMIT = 4096;

/** The details block trimmed to whatever the rest of the message leaves
 *  free, dropped entirely when that is too little to be worth reading.
 *  Trimming happens at a line boundary so the block never ends mid-fact. */
function fitRevealDetails(args: RevealMessageArgs): string | null {
  const details = args.details?.trim();
  if (!details) return null;
  const withoutDetails = buildRevealMessage({ ...args, details: null });
  const budget = WHATSAPP_TEXT_LIMIT - withoutDetails.length - '\n\n'.length;
  if (details.length <= budget) return details;
  const lines = details.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }
  return kept.length > 1 ? kept.join('\n') : null;
}

export interface RevealMessageArgs {
  requesterName: string;
  propertyTitle: string;
  revealLink: string;
  scope?: 'location' | 'listing';
  /** The property block from `buildRevealDetails` — the specs and the
   *  exact address, so the seeker has the property in WhatsApp itself
   *  and not only behind the link. */
  details?: string | null;
  /** Placed last: WhatsApp previews the FIRST url in a message, and the
   *  preview belongs to the reveal link. */
  mapUrl?: string | null;
}

export function buildRevealMessage(args: RevealMessageArgs): string {
  const mapLine = args.mapUrl ? `🗺 Map pin: ${args.mapUrl}` : null;
  const detailsBlock = fitRevealDetails(args);
  if (args.scope === 'listing') {
    return [
      `🔓 *Access Approved — ${args.propertyTitle}*\n\n` +
        `Hi ${args.requesterName}, the owner has approved your request to view this listing.`,
      detailsBlock,
      `🏡 Full details, photos, address & map pin: ${args.revealLink}`,
      mapLine,
      `🔒 The owner has asked that these details stay between us — please don't forward the link or the photos. ` +
        `Every photo carries your reference so we can honour that.\n\n` +
        `⏳ This link is valid for 7 days.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  return [
    `📍 *Exact Location — ${args.propertyTitle}*\n\n` +
      `Hi ${args.requesterName}, your location request was approved.`,
    detailsBlock,
    `🗺 Address, map pin & full photos: ${args.revealLink}`,
    mapLine,
    `⏳ This link is valid for 48 hours.`,
  ]
    .filter(Boolean)
    .join('\n\n');
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

/**
 * The title to use when writing to a SEEKER or an intermediary. A stored
 * title routinely carries the street or the project name, and every
 * message built from this one — the consent ask, the rejection redirect,
 * the reveal — reaches someone the listing side has not approved yet. A
 * teaser-gated listing therefore names itself by its stub.
 */
async function propertyTitle(
  admin: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<string> {
  const { data } = await admin
    .from('properties')
    .select(
      'title, type, bedrooms, sublocality, city, state, showcase_visibility'
    )
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return 'the property';
  const row = data as { title?: string; showcase_visibility?: string | null };
  if (isTeaserGated(row)) {
    return teaserTitle(
      data as {
        type?: string | null;
        bedrooms?: number | null;
        sublocality?: string | null;
        city?: string | null;
        state?: string | null;
      }
    );
  }
  return row.title || 'the property';
}

async function sendToSeeker(
  accountId: string,
  requesterPhone: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  const phone = normalizePhoneWithCountryCode(requesterPhone);
  if (!phone) return { success: false, error: 'No reachable phone' };
  // Reaching the seeker needs a contact row, and the dispatcher creates
  // one when the phone is unknown — which is how the header's promise
  // that no Engine contact is created for a seeker was quietly broken.
  // It is created chain_only instead: addressable by this module,
  // invisible to the listing side's pipeline. A seeker who is already a
  // contact here is matched, not re-created, so nothing is downgraded.
  const res = await sendWhatsAppMessageAndPersist({
    accountId,
    toPhone: phone,
    kind: 'text',
    senderType: 'bot',
    text,
    createAsChainOnly: true,
    allowChainOnly: true,
  });
  if (!res.success) {
    console.error('[location-requests] Seeker send failed:', res.error);
  }
  return { success: res.success, error: res.error };
}

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

/**
 * Delivers the reveal to the seeker, template-first in spirit: the
 * free-form message goes out when the 24-hour window happens to be
 * open; a closed window (seekers request from the public showcase, so
 * it usually is) falls back to the pre-approved `location_reveal`
 * Utility template carrying the token as the URL button suffix.
 * Returns whether Meta accepted a send at all — the caller must not
 * mark the reveal as sent otherwise.
 */
async function sendRevealToSeeker(
  admin: SupabaseClient,
  request: Pick<
    LocationRequestRow,
    | 'account_id'
    | 'requester_name'
    | 'requester_phone'
    | 'via_contact_id'
    | 'scope'
  >,
  propertyTitle: string,
  shareLink: string,
  token: string,
  details: RevealDetails | null
): Promise<boolean> {
  const freeform = await sendToSeeker(
    request.account_id,
    request.requester_phone,
    buildRevealMessage({
      requesterName: request.requester_name,
      propertyTitle,
      revealLink: shareLink,
      scope: request.scope,
      details: details?.body ?? null,
      mapUrl: details?.mapUrl ?? null,
    })
  );
  if (freeform.success) return true;
  if (!isReengagementError(freeform.error)) return false;

  // The reveal goes to the SEEKER. They reached us from the public
  // showcase and may have no contact row at all, in which case
  // loadTemplateForContact falls through to the account default —
  // which is the right answer for an unknown recipient of a
  // brokerage that writes in Tamil.
  const {
    template,
    language: revealLanguage,
    fellBack,
  } = await loadTemplateForContact<MessageTemplate>(admin, {
    accountId: request.account_id,
    contactId: request.via_contact_id,
    names: [LOCATION_REVEAL_TEMPLATE_NAME],
  });
  if (fellBack) {
    warnLanguageFallback(
      'location-requests',
      request.account_id,
      revealLanguage,
      template
    );
  }
  if (template?.status !== 'APPROVED') {
    console.error(
      '[location-requests] Reveal undeliverable: window closed and no approved location_reveal template'
    );
    return false;
  }

  const phone = normalizePhoneWithCountryCode(request.requester_phone);
  if (!phone) return false;
  const params = buildLocationRevealParams(
    request.requester_name,
    propertyTitle,
    details?.specs,
    details?.address
  );
  const bodyParams = truncateParametersToBudget(template.body_text, [
    ...params,
  ]);
  const buttonParams: Record<number, string> = {};
  (template.buttons ?? []).forEach((btn, idx) => {
    if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
      buttonParams[idx] = token;
    }
  });
  const res = await sendWhatsAppMessageAndPersist({
    accountId: request.account_id,
    toPhone: phone,
    kind: 'template',
    senderType: 'bot',
    templateName: template.name,
    templateLanguage: template.language || 'en_US',
    templateParams: bodyParams,
    messageParams: {
      body: bodyParams,
      ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
    },
    templateRow: template,
    text: resolveTemplateBodyText(template.body_text, bodyParams),
    createAsChainOnly: true,
    allowChainOnly: true,
  });
  if (!res.success) {
    console.error(
      '[location-requests] Reveal template send failed:',
      res.error
    );
  }
  return res.success;
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

  const consentText = buildConsentMessage({
    coBrokerName: contact.name || 'there',
    propertyTitle: title,
    requesterName: request.requester_name,
    requesterPhone: request.requester_phone,
  });

  try {
    const interactive = await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      contactId: contact.id,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'buttons',
      interactiveBody: consentText,
      interactiveButtons: [
        { id: `${CONSENT_APPROVE_PREFIX}${request.id}`, title: '✅ Approve' },
        { id: `${CONSENT_DECLINE_PREFIX}${request.id}`, title: '❌ Decline' },
      ],
      allowChainOnly: true,
    });
    if (!interactive.success) {
      if (!isReengagementError(interactive.error)) {
        console.error(
          '[location-requests] Consent send failed:',
          interactive.error
        );
        return false;
      }

      const { template, language, fellBack } =
        await loadTemplateForContact<MessageTemplate>(admin, {
          accountId: request.account_id,
          contactId: contact.id,
          names: [LOCATION_CONSENT_TEMPLATE_NAME],
        });
      if (fellBack) {
        warnLanguageFallback(
          'location-consent',
          request.account_id,
          language,
          template
        );
      }
      if (!template || (template.status ?? '').toUpperCase() !== 'APPROVED') {
        console.error(
          '[location-requests] Consent undeliverable: window closed and no approved location_consent_request template'
        );
        return false;
      }

      const params = truncateParametersToBudget(
        template.body_text,
        buildLocationConsentParams(
          contact.name,
          title,
          `${maskName(request.requester_name)} (${maskPhone(request.requester_phone)})`
        )
      );
      const templateSend = await sendWhatsAppMessageAndPersist({
        accountId: request.account_id,
        contactId: contact.id,
        kind: 'template',
        senderType: 'bot',
        templateName: template.name,
        templateLanguage: template.language || 'en_US',
        templateParams: params,
        messageParams: {
          body: params,
          buttonParams: {
            0: `${CONSENT_APPROVE_PREFIX}${request.id}`,
            1: `${CONSENT_DECLINE_PREFIX}${request.id}`,
          },
        },
        templateRow: template,
        text: resolveTemplateBodyText(template.body_text, params),
        allowChainOnly: true,
      });
      if (!templateSend.success) {
        console.error(
          '[location-requests] Consent template send failed:',
          templateSend.error
        );
        return false;
      }
    }
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

/** The Engine contact card mirroring the listing-side user's own
 *  WhatsApp (matched by profile email) — the channel owner pings and
 *  their button replies arrive on. */
/**
 * The WhatsApp number the listing side's Approve/Reject ping goes to.
 *
 * Matching the staff profile to a `contacts` row by email is the
 * preferred path — it threads the ping into an existing chat. But it is
 * a coincidence, not a guarantee: a brokerage has no reason to keep a
 * contact card for its own owner, and when there is none this returned
 * null and the ping was skipped ENTIRELY AND SILENTLY. The account
 * holder then had no way to approve from WhatsApp at all, which is the
 * whole point of the ping. Verified on a live account: the owner's
 * profile carried a phone, no contact matched their email, and no ping
 * was ever sent.
 *
 * So the profile's own phone is the fallback. `contactId` is null in
 * that case and the dispatcher resolves (or creates) the contact from
 * the number, exactly as it does for any other outbound send.
 */
export async function resolveOwnerWhatsAppContact(
  admin: SupabaseClient,
  accountId: string,
  targetUserId: string
): Promise<{ contactId: string | null; phone: string } | null> {
  const { data: agentProfile } = await admin
    .from('profiles')
    .select('email, phone')
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (!agentProfile) return null;

  if (agentProfile.email) {
    const { data: agentContact } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('account_id', accountId)
      .eq('email', agentProfile.email)
      .maybeSingle();
    if (agentContact?.phone) {
      return { contactId: agentContact.id, phone: agentContact.phone };
    }
  }

  const profilePhone = normalizePhoneWithCountryCode(agentProfile.phone || '');
  if (!profilePhone) return null;

  const { data: byPhone } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', profilePhone)
    .maybeSingle();

  return { contactId: byPhone?.id ?? null, phone: profilePhone };
}

async function resolveOwnerUserId(
  admin: SupabaseClient,
  request: Pick<LocationRequestRow, 'account_id' | 'property_id'>
): Promise<string | null> {
  const { data: property } = await admin
    .from('properties')
    .select('user_id')
    .eq('id', request.property_id)
    .eq('account_id', request.account_id)
    .maybeSingle();
  if (property?.user_id) return property.user_id as string;

  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', request.account_id)
    .maybeSingle();
  return (account?.owner_user_id as string | undefined) ?? null;
}

/** Notifies the listing side that a request awaits their decision:
 *  in-app bell + mobile push through the notification system, plus a
 *  WhatsApp ping with Approve/Reject buttons so the owner can decide
 *  without opening the dashboard. Channels follow the account's
 *  Settings → Notifications preferences for `location_request`. */
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
    | 'scope'
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
  const propertyLine = `${property.title}${property.property_code ? ` (${property.property_code})` : ''}`;
  const listingScope = request.scope === 'listing';
  const headline = listingScope
    ? '🔓 Listing access request'
    : '📍 Location reveal request';

  const channels = await resolveChannels(
    request.account_id,
    'location_request'
  );

  await createNotification({
    accountId: request.account_id,
    userId: targetUserId,
    type: 'location_request',
    title: headline,
    body: `${propertyLine} — ${fromLine}`,
    entityType: 'property',
    entityId: property.id,
    link: `/inventory?propertyId=${property.property_code || property.id}`,
    channels: { inApp: channels.inApp, push: channels.push, whatsapp: false },
  });

  if (!channels.whatsapp) return;

  try {
    const agent = await resolveOwnerWhatsAppContact(
      admin,
      request.account_id,
      targetUserId
    );
    if (!agent) return;

    const interactiveBody =
      `${listingScope ? '🔓 *New Listing Access Request*' : '📍 *New Location Reveal Request*'}\n` +
      `Property: ${propertyLine}\n` +
      `${fromLine}\n\n` +
      (listingScope
        ? `Approve to open the full listing page for this requester on WhatsApp — their link expires in 7 days, ` +
          `is revocable, and every photo they see is watermarked to them. Reject to redirect them `
        : `Approve to send the exact location to the requester via WhatsApp, or reject to redirect them `) +
      `to the person who shared them the property. ` +
      `Also available on your dashboard.`;
    const interactive = await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      userId: targetUserId,
      ...(agent.contactId
        ? { contactId: agent.contactId }
        : { toPhone: agent.phone }),
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'buttons',
      interactiveBody,
      interactiveButtons: [
        { id: `${OWNER_APPROVE_PREFIX}${request.id}`, title: '✅ Approve' },
        { id: `${OWNER_REJECT_PREFIX}${request.id}`, title: '❌ Reject' },
      ],
    });
    if (interactive.success) return;
    if (!isReengagementError(interactive.error)) {
      console.error(
        '[location-requests] Owner notify failed:',
        interactive.error
      );
      return;
    }

    const { template, language, fellBack } =
      await loadTemplateForContact<MessageTemplate>(admin, {
        accountId: request.account_id,
        contactId: agent.contactId,
        names: [LOCATION_OWNER_DECISION_TEMPLATE_NAME],
      });
    if (fellBack) {
      warnLanguageFallback(
        'location-owner-decision',
        request.account_id,
        language,
        template
      );
    }
    if (!template || (template.status ?? '').toUpperCase() !== 'APPROVED') {
      console.error(
        '[location-requests] Owner notification undeliverable: window closed and no approved location_owner_decision template'
      );
      return;
    }

    const params = truncateParametersToBudget(
      template.body_text,
      buildLocationOwnerDecisionParams({
        scope: request.scope,
        property: propertyLine,
        requester: attributed
          ? `${maskName(request.requester_name)} · ${maskPhone(request.requester_phone)}`
          : `${request.requester_name} · ${request.requester_phone}`,
      })
    );
    const templateSend = await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      userId: targetUserId,
      ...(agent.contactId
        ? { contactId: agent.contactId }
        : { toPhone: agent.phone }),
      kind: 'template',
      senderType: 'bot',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: params,
      messageParams: {
        body: params,
        buttonParams: {
          0: `${OWNER_APPROVE_PREFIX}${request.id}`,
          1: `${OWNER_REJECT_PREFIX}${request.id}`,
        },
      },
      templateRow: template,
      text: resolveTemplateBodyText(template.body_text, params),
    });
    if (!templateSend.success) {
      console.error(
        '[location-requests] Owner decision template send failed:',
        templateSend.error
      );
    }
  } catch (err) {
    console.error('[location-requests] Owner notify failed:', err);
  }
}

export function parseOwnerReply(
  replyId: string
): { requestId: string; decision: 'approve' | 'reject' } | null {
  if (replyId.startsWith(OWNER_APPROVE_PREFIX)) {
    return {
      requestId: replyId.slice(OWNER_APPROVE_PREFIX.length),
      decision: 'approve',
    };
  }
  if (replyId.startsWith(OWNER_REJECT_PREFIX)) {
    return {
      requestId: replyId.slice(OWNER_REJECT_PREFIX.length),
      decision: 'reject',
    };
  }
  return null;
}

/**
 * Handles the listing side's Approve/Reject button reply from the
 * owner-queue WhatsApp ping. Returns true when the reply targeted an
 * owner decision and is fully handled. Only the resolved listing-side
 * contact may decide — a forwarded button tapped by anyone else is
 * ignored, and a request no longer sitting in the owner queue
 * (already decided, or back with an intermediary) is left untouched.
 */
export async function handleOwnerLocationReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const parsed = parseOwnerReply(args.replyId);
  if (!parsed) return false;

  const { data } = await args.admin
    .from('property_location_requests')
    .select('*')
    .eq('id', parsed.requestId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  const request = data as LocationRequestRow | null;
  if (!request) return true;
  if (request.status !== 'pending' || request.pending_consent_contact_id)
    return true;

  const targetUserId = await resolveOwnerUserId(args.admin, request);
  if (!targetUserId) return true;
  const agent = await resolveOwnerWhatsAppContact(
    args.admin,
    args.accountId,
    targetUserId
  );
  if (!agent || !phonesMatch(agent.phone, args.senderPhone)) return true;

  const title = await propertyTitle(
    args.admin,
    request.account_id,
    request.property_id
  );

  let ackText: string;
  if (parsed.decision === 'approve') {
    const { revealDelivered } = await approveRequestAndSendReveal(
      args.admin,
      request,
      targetUserId
    );
    ackText = revealDelivered
      ? `✅ Approved — ConvoReal has sent the exact location for *${title}* to the requester on WhatsApp.`
      : `✅ Approved — but the reveal for *${title}* could not be delivered on WhatsApp. Open the property in your dashboard to copy the reveal link.`;
  } else {
    await closeRequestWithRedirect(args.admin, request, 'rejected');
    ackText = `👍 Noted — the request for *${title}* was rejected. The requester has been redirected to the person who shared them the property.`;
  }

  try {
    await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      userId: targetUserId,
      ...(agent.contactId
        ? { contactId: agent.contactId }
        : { toPhone: agent.phone }),
      kind: 'text',
      senderType: 'bot',
      text: ackText,
    });
  } catch (err) {
    console.error('[location-requests] Owner ack failed:', err);
  }
  return true;
}

/**
 * Mints the share grant that opens a teaser-gated page for an approved
 * listing-scope request. Returns null when the grant could not be
 * written — the caller still approves the request, and the reveal page
 * reports the link as expired rather than showing a listing it has no
 * key for.
 */
async function mintListingGrant(
  admin: SupabaseClient,
  request: LocationRequestRow,
  approvedByUserId: string | null
): Promise<{ id: string; token: string } | null> {
  const { token, expiresAt } = mintShareGrantToken(SHARE_GRANT_TTL_MS);
  const { data, error } = await admin
    .from('property_share_grants')
    .insert({
      account_id: request.account_id,
      property_id: request.property_id,
      contact_id: request.contact_id ?? null,
      created_by: approvedByUserId,
      token,
      reveal_listing: true,
      // Approving a listing request grants the WHOLE file — page,
      // address, map pin and the guarded photos.
      //
      // An earlier cut granted only the page and left the address
      // behind its own separate request, on the reasoning that the two
      // guards should compose. Delivery proved that wrong: outside the
      // 24-hour window the reveal goes out on the approved
      // `location_reveal` template, whose fixed copy promises "the
      // address, map pin and full photos". A template's wording cannot
      // be re-cut without a new name and a fresh category roll
      // (AGENTS.md §2.7), so the choice was to make the promise true or
      // to send one the recipient would find false. It is now true.
      //
      // This is also the plainer bargain: the owner approved this
      // person, so this person sees the property.
      reveal_location: true,
      reveal_private_images: true,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[location-requests] Listing grant mint failed:', error);
    return null;
  }
  return { id: data.id as string, token };
}

/**
 * What an approved reveal carries about the property: the multi-line
 * block for the free-form message, and the same facts flattened onto
 * single lines for the template path, which cannot take a newline.
 */
interface RevealDetails {
  body: string;
  mapUrl: string | null;
  specs: string;
  address: string;
}

/**
 * The property block that travels with an approved reveal. Approval is
 * what lifts the guard, so this is read straight from the row and is
 * deliberately unmasked — and it goes out on the account's own WhatsApp
 * number like every other Engine send, never from the approver's
 * personal phone.
 */
async function loadRevealDetails(
  admin: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<RevealDetails | null> {
  const { data, error } = await admin
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.error('[location-requests] Reveal details load failed:', error);
    }
    return null;
  }
  const property = data as unknown as Property;
  const { body, mapUrl } = buildRevealDetails({ property });
  const { specs, address } = buildRevealTemplateFacts({ property });
  return { body, mapUrl, specs, address };
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
): Promise<{ shareLink: string; revealDelivered: boolean }> {
  // A listing-scope approval opens the teaser-gated page, and the grant
  // it mints carries the address and guarded photos with it — see
  // mintListingGrant for why that is one decision and not two.
  const grant =
    request.scope === 'listing'
      ? await mintListingGrant(admin, request, approvedByUserId)
      : null;

  // The link the seeker receives always points at /reveal/<token>,
  // because that is where the approved `location_reveal` template's URL
  // button goes and a template's category is unfixable once approved
  // (AGENTS.md §2.7). But WHICH token differs, and deliberately so.
  //
  // A listing approval sends the GRANT token and leaves share_token
  // NULL. Older code — a not-yet-deployed instance, or a rollback —
  // resolves /reveal/ by share_token alone and knows nothing of scope,
  // so handed a reveal token it would serve its address card for a
  // listing that was never approved for an address. Sending a token it
  // cannot resolve makes that path fail closed: it renders "invalid"
  // instead of disclosing a location. Verified against production
  // during end-to-end testing, where the old page did exactly that.
  const listingToken = grant?.token ?? null;
  const { token: revealToken, expiresAt } = mintRevealToken();
  const token = listingToken ?? revealToken;
  const shareLink = `${revealBaseUrl()}/reveal/${token}`;

  await admin
    .from('property_location_requests')
    .update({
      status: 'approved',
      share_token: listingToken ? null : revealToken,
      share_token_expires_at: listingToken ? null : expiresAt,
      granted_share_id: grant?.id ?? null,
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
  const details = await loadRevealDetails(
    admin,
    request.account_id,
    request.property_id
  );
  const revealDelivered = await sendRevealToSeeker(
    admin,
    request,
    title,
    shareLink,
    token,
    details
  );
  if (revealDelivered) {
    await admin
      .from('property_location_requests')
      .update({ share_sent_at: new Date().toISOString() })
      .eq('id', request.id);
  }

  if (request.via_contact_id) {
    try {
      await sendWhatsAppMessageAndPersist({
        accountId: request.account_id,
        contactId: request.via_contact_id,
        kind: 'text',
        senderType: 'bot',
        text: buildCoBrokerRevealNotice(title),
        allowChainOnly: true,
      });
    } catch (err) {
      console.error('[location-requests] Co-broker notice failed:', err);
    }
  }

  return { shareLink, revealDelivered };
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
      allowChainOnly: true,
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
