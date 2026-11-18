// ============================================================
// Referred enquiries — the consent step between a guest of an
// agent's forwarded showcase link and the listing account.
//
// The listing side shares a personalized link with an agent, the
// agent forwards it, and the agent's client enquires. That client is
// the agent's, not the listing account's: location-requests.ts
// already refuses to let a co-broker's client be reached through
// their own location request, and an enquiry is the same case.
//
// So the enquiry is held. The listing side is told at once that a
// guest of that agent enquired, with the guest's name and number
// masked. The agent is asked on WhatsApp to approve or decline. On
// approval the guest becomes an ordinary lead credited to the agent;
// on a decline, or after two hours without an answer, the guest is
// pointed back to the agent and never reaches the contacts list.
//
// Only links shared with a contact classified as Agent go through
// this. A buyer or owner who forwards a link is credited as the
// referrer and the enquiry is filed straight away.
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
  LOCATION_CONSENT_TEMPLATE_NAME,
  buildLocationConsentParams,
} from '@/lib/whatsapp/location-request-templates';
import {
  normalizePhoneWithCountryCode,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils';
import { maskName, maskPhone } from '@/lib/inventory/location-guard';
import {
  buildSeekerRedirectMessage,
  propertyTitle as seekerSafePropertyTitle,
} from '@/lib/inventory/location-requests';
import { createNotification } from '@/lib/notifications/create';
import { alertAgentOfPropertyEnquiry } from '@/lib/whatsapp/enquiry-alert';
import {
  fileShowcaseInquiry,
  type ShowcaseInquiryInput,
} from '@/lib/showcase/file-inquiry';
import type { MessageTemplate } from '@/types';

export const REFERRAL_CONSENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const REPEAT_DECLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_TAP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const REFERRED_APPROVE_PREFIX = 'refenq_approve:';
export const REFERRED_DECLINE_PREFIX = 'refenq_decline:';

const SESSION_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PHONE_RE = /^\+?\d{6,15}$/;

export type ReferredEnquirySource = 'website' | 'whatsapp';
export type ReferredEnquiryStatus =
  'pending' | 'approved' | 'rejected' | 'expired';

export interface WhatsAppEnquiryPayload {
  targetAgentUserId: string;
  propertyTitle: string | null;
  enquiryText: string;
}

export interface ReferredEnquiryRow {
  id: string;
  account_id: string;
  via_contact_id: string;
  property_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  source: ReferredEnquirySource;
  requester_name: string;
  requester_phone: string;
  session_key: string | null;
  payload: ShowcaseInquiryInput | WhatsAppEnquiryPayload;
  status: ReferredEnquiryStatus;
  consent_requested_at: string | null;
  decided_at: string | null;
}

export interface ShowcaseReferrer {
  contactId: string;
  name: string;
  phone: string | null;
  isAgent: boolean;
}

export type OpenReferredOutcome = 'pending' | 'closed' | 'undeliverable';

export function parseReferredReply(
  replyId: string
): { requestId: string; decision: 'approve' | 'decline' } | null {
  if (replyId.startsWith(REFERRED_APPROVE_PREFIX)) {
    return {
      requestId: replyId.slice(REFERRED_APPROVE_PREFIX.length),
      decision: 'approve',
    };
  }
  if (replyId.startsWith(REFERRED_DECLINE_PREFIX)) {
    return {
      requestId: replyId.slice(REFERRED_DECLINE_PREFIX.length),
      decision: 'decline',
    };
  }
  return null;
}

export function maskedGuest(name: string, phone: string): string {
  return `${maskName(name)} (${maskPhone(phone)})`;
}

export function buildReferrerAskMessage(args: {
  referrerName: string;
  subject: string;
  requesterName: string;
  requesterPhone: string;
}): string {
  return (
    `🤝 Hi ${args.referrerName},\n\n` +
    `Someone who opened the link we shared with you — *${maskName(args.requesterName)}* (${maskPhone(args.requesterPhone)}) — ` +
    `has asked for more details on *${args.subject}*.\n\n` +
    `Approve and our team will take the enquiry forward with them directly, with you recorded as the referrer. ` +
    `Decline and we will not contact them: they will be asked to speak with you instead.\n\n` +
    `No answer within 2 hours counts as a decline.`
  );
}

export function buildGuestHoldAck(
  guestName: string | null | undefined,
  subject: string
): string {
  const first = (guestName || '').trim().split(/\s+/)[0];
  return `${first ? `Thanks ${first}!` : 'Thanks!'} Your enquiry for *${subject}* has been received. You will hear back here shortly.`;
}

function safeSessionKey(sessionKey: string | null | undefined): string | null {
  const key = (sessionKey || '').trim();
  return SESSION_KEY_RE.test(key) ? key : null;
}

function firstName(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

async function loadReferrer(
  admin: SupabaseClient,
  accountId: string,
  contactId: string,
  requesterPhone: string
): Promise<ShowcaseReferrer | null> {
  const { data } = await admin
    .from('contacts')
    .select('id, name, phone, classification')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return null;
  if (data.phone && phonesMatch(data.phone as string, requesterPhone)) {
    return null;
  }
  return {
    contactId: data.id as string,
    name: ((data.name as string) || '').trim() || 'An agent',
    phone: (data.phone as string | null) ?? null,
    isAgent: data.classification === 'Agent',
  };
}

/**
 * The contact whose forwarded link this browser session arrived
 * through, read from the events the beacon recorded. The beacon
 * decides guest-or-recipient on the server (PLS-003), so this never
 * trusts a referrer id the browser sends: a session the showcase knows
 * as a contact, or one with no forwarded-link events, has no referrer,
 * and nor does the link's own recipient enquiring for themselves.
 */
export async function resolveSessionReferrer(
  admin: SupabaseClient,
  args: { accountId: string; sessionKey: string | null; requesterPhone: string }
): Promise<ShowcaseReferrer | null> {
  const key = safeSessionKey(args.sessionKey);
  if (!key) return null;
  const { data } = await admin
    .from('showcase_events')
    .select('contact_id, via_contact_id')
    .eq('account_id', args.accountId)
    .eq('session_key', key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.contact_id || !data.via_contact_id) return null;
  return loadReferrer(
    admin,
    args.accountId,
    data.via_contact_id as string,
    args.requesterPhone
  );
}

/**
 * The referrer behind a WhatsApp enquiry. The showcase's WhatsApp
 * button opens the guest's own WhatsApp, so the message arrives from a
 * number the showcase has never seen. What ties it to a browser is the
 * reference the button writes into the prefilled text on a
 * personalized link (enquiry-ref.ts): the start of that browser's
 * session key. The enquiry is a guest's only when that same session
 * tapped the button on this listing as a forwarded-link guest, so a
 * direct buyer who happens to write in about the listing while an
 * agent's guest is browsing it is never mistaken for that guest.
 */
export async function resolveWhatsAppTapReferrer(
  admin: SupabaseClient,
  args: {
    accountId: string;
    propertyId: string;
    senderPhone: string;
    enquiryRef: string | null;
  }
): Promise<(ShowcaseReferrer & { sessionKey: string | null }) | null> {
  if (!args.enquiryRef || !/^[0-9a-f]{8}$/.test(args.enquiryRef)) return null;
  const since = new Date(Date.now() - WHATSAPP_TAP_WINDOW_MS).toISOString();
  const { data } = await admin
    .from('showcase_events')
    .select('via_contact_id, session_key')
    .eq('account_id', args.accountId)
    .eq('property_id', args.propertyId)
    .eq('event_type', 'whatsapp_click')
    .like('session_key', `${args.enquiryRef}%`)
    .is('contact_id', null)
    .not('via_contact_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.via_contact_id) return null;
  const referrer = await loadReferrer(
    admin,
    args.accountId,
    data.via_contact_id as string,
    args.senderPhone
  );
  return referrer
    ? { ...referrer, sessionKey: (data.session_key as string | null) ?? null }
    : null;
}

/**
 * The last referred enquiry held for a WhatsApp guest, with the agent
 * it was referred by. A guest the agent declined stays hidden, so this
 * is how a later message from them is still recognised as that agent's
 * guest instead of reaching the listing side as a new lead.
 */
export async function lastGuestEnquiry(
  admin: SupabaseClient,
  args: { accountId: string; contactId: string; senderPhone: string }
): Promise<{
  status: ReferredEnquiryStatus;
  sessionKey: string | null;
  referrer: ShowcaseReferrer | null;
} | null> {
  // By number as well as by contact: an enquiry made on the showcase
  // form is stored against the number the guest typed and has no
  // contact until it is approved, while declining it leaves a hidden
  // contact behind for that same number.
  const digits = args.senderPhone.replace(/\D/g, '');
  const filter = [`contact_id.eq.${args.contactId}`];
  if (/^\d{6,15}$/.test(digits)) {
    filter.push(
      `requester_phone.eq.${digits}`,
      `requester_phone.eq.+${digits}`
    );
  }
  const { data } = await admin
    .from('referred_enquiries')
    .select('status, via_contact_id, session_key')
    .eq('account_id', args.accountId)
    .or(filter.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    status: data.status as ReferredEnquiryStatus,
    sessionKey: (data.session_key as string | null) ?? null,
    referrer: await loadReferrer(
      admin,
      args.accountId,
      data.via_contact_id as string,
      args.senderPhone
    ),
  };
}

/** True when this number already belongs to an ordinary lead of the
 *  account. Such a visitor is the listing side's own contact whatever
 *  link they arrived through, so their enquiry is never held. */
export async function isExistingLead(
  admin: SupabaseClient,
  accountId: string,
  phone: string
): Promise<boolean> {
  if (!PHONE_RE.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  const { data } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_merged', false)
    .eq('chain_only', false)
    .or(`phone.eq.${digits},phone.eq.+${digits}`)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

function guestFilter(row: {
  requester_phone: string;
  session_key: string | null;
}): string {
  const parts: string[] = [];
  if (PHONE_RE.test(row.requester_phone)) {
    parts.push(`requester_phone.eq.${row.requester_phone}`);
  }
  const key = safeSessionKey(row.session_key);
  if (key) parts.push(`session_key.eq.${key}`);
  return parts.join(',');
}

async function enquirySubject(
  admin: SupabaseClient,
  row: Pick<
    ReferredEnquiryRow,
    'account_id' | 'property_id' | 'source' | 'payload'
  >
): Promise<string> {
  if (row.source === 'website') {
    const payload = row.payload as ShowcaseInquiryInput;
    if (payload.isShortlist && payload.propertyTitle)
      return payload.propertyTitle;
  }
  if (!row.property_id) return 'our listings';
  return seekerSafePropertyTitle(admin, row.account_id, row.property_id);
}

function notifyUserId(row: Pick<ReferredEnquiryRow, 'payload'>): string {
  return row.payload.targetAgentUserId;
}

async function askReferrer(
  admin: SupabaseClient,
  row: ReferredEnquiryRow,
  referrer: ShowcaseReferrer,
  subject: string
): Promise<boolean> {
  if (!referrer.phone || !normalizePhoneWithCountryCode(referrer.phone)) {
    return false;
  }
  const approveId = `${REFERRED_APPROVE_PREFIX}${row.id}`;
  const declineId = `${REFERRED_DECLINE_PREFIX}${row.id}`;
  try {
    const interactive = await sendWhatsAppMessageAndPersist({
      accountId: row.account_id,
      contactId: referrer.contactId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'buttons',
      interactiveBody: buildReferrerAskMessage({
        referrerName: firstName(referrer.name),
        subject,
        requesterName: row.requester_name,
        requesterPhone: row.requester_phone,
      }),
      interactiveButtons: [
        { id: approveId, title: '✅ Approve' },
        { id: declineId, title: '❌ Decline' },
      ],
      allowChainOnly: true,
    });
    if (interactive.success) return true;
    if (!isReengagementError(interactive.error)) {
      console.error('[referred-enquiries] Ask failed:', interactive.error);
      return false;
    }

    // Outside the agent's 24-hour window the ask rides the consent
    // template the location flow already has approved: it says a
    // contact from their shared link asked for access, masks the
    // requester and carries Approve / Decline. A template's category
    // is fixed at first review (AGENTS.md §2.7), so an approved one
    // whose params match is reused rather than a new name submitted.
    const { template, language, fellBack } =
      await loadTemplateForContact<MessageTemplate>(admin, {
        accountId: row.account_id,
        contactId: referrer.contactId,
        names: [LOCATION_CONSENT_TEMPLATE_NAME],
      });
    if (fellBack) {
      warnLanguageFallback(
        'referred-enquiry-consent',
        row.account_id,
        language,
        template
      );
    }
    if (!template || (template.status ?? '').toUpperCase() !== 'APPROVED') {
      console.error(
        '[referred-enquiries] Ask undeliverable: window closed and no approved location_consent_request template'
      );
      return false;
    }
    const params = truncateParametersToBudget(
      template.body_text,
      buildLocationConsentParams(
        referrer.name,
        subject,
        maskedGuest(row.requester_name, row.requester_phone)
      )
    );
    const templateSend = await sendWhatsAppMessageAndPersist({
      accountId: row.account_id,
      contactId: referrer.contactId,
      kind: 'template',
      senderType: 'bot',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: params,
      messageParams: {
        body: params,
        buttonParams: { 0: approveId, 1: declineId },
      },
      templateRow: template,
      text: template.body_text.replace(/\{\{(\d+)\}\}/g, (match, n) => {
        const idx = parseInt(n) - 1;
        return idx >= 0 && idx < params.length ? params[idx] : match;
      }),
      allowChainOnly: true,
    });
    if (!templateSend.success) {
      console.error(
        '[referred-enquiries] Ask template send failed:',
        templateSend.error
      );
    }
    return templateSend.success;
  } catch (err) {
    console.error('[referred-enquiries] Ask failed:', err);
    return false;
  }
}

async function notifyListingSide(args: {
  accountId: string;
  userId: string;
  title: string;
  body: string;
  contactId: string;
}): Promise<void> {
  await createNotification({
    accountId: args.accountId,
    userId: args.userId,
    type: 'listing_interest',
    eventKey: 'referred_enquiry',
    title: args.title,
    body: args.body,
    entityType: 'contact',
    entityId: args.contactId,
    link: `/contacts?contactId=${args.contactId}`,
  });
}

async function sendToReferrer(
  row: Pick<ReferredEnquiryRow, 'account_id' | 'via_contact_id'>,
  text: string
): Promise<void> {
  try {
    await sendWhatsAppMessageAndPersist({
      accountId: row.account_id,
      contactId: row.via_contact_id,
      kind: 'text',
      senderType: 'bot',
      text,
      allowChainOnly: true,
    });
  } catch (err) {
    console.error('[referred-enquiries] Referrer message failed:', err);
  }
}

async function redirectGuest(
  accountId: string,
  phone: string,
  subject: string
): Promise<boolean> {
  const toPhone = normalizePhoneWithCountryCode(phone);
  if (!toPhone) return false;
  try {
    const res = await sendWhatsAppMessageAndPersist({
      accountId,
      toPhone,
      kind: 'text',
      senderType: 'bot',
      text: buildSeekerRedirectMessage(subject),
      createAsChainOnly: true,
      allowChainOnly: true,
    });
    if (!res.success) {
      console.error(
        isReengagementError(res.error)
          ? '[referred-enquiries] Guest redirect not sent: no open WhatsApp window'
          : '[referred-enquiries] Guest redirect failed'
      );
    }
    return res.success;
  } catch {
    console.error('[referred-enquiries] Guest redirect failed');
    return false;
  }
}

/**
 * Holds an enquiry from a guest of an agent's forwarded link and asks
 * the agent. Returns:
 *  - 'pending': held; the agent has been asked (now, or for an earlier
 *    enquiry from the same guest that is still waiting).
 *  - 'closed': the agent declined this guest within the last day, so
 *    the enquiry is closed without asking again.
 *  - 'undeliverable': the agent could not be reached on WhatsApp, so
 *    nothing is held and the caller files the enquiry as usual with
 *    the agent credited as referrer.
 */
export async function openReferredEnquiry(
  admin: SupabaseClient,
  args: {
    accountId: string;
    referrer: ShowcaseReferrer;
    source: ReferredEnquirySource;
    propertyId: string | null;
    requesterName: string;
    requesterPhone: string;
    sessionKey: string | null;
    payload: ShowcaseInquiryInput | WhatsAppEnquiryPayload;
    contactId?: string | null;
    conversationId?: string | null;
  }
): Promise<OpenReferredOutcome> {
  const sessionKey = safeSessionKey(args.sessionKey);
  const base = {
    account_id: args.accountId,
    via_contact_id: args.referrer.contactId,
    property_id: args.propertyId,
    contact_id: args.contactId ?? null,
    conversation_id: args.conversationId ?? null,
    source: args.source,
    requester_name: args.requesterName,
    requester_phone: args.requesterPhone,
    session_key: sessionKey,
    payload: args.payload,
  };

  const filter = guestFilter({
    requester_phone: args.requesterPhone,
    session_key: sessionKey,
  });
  let earlier: Array<
    Pick<ReferredEnquiryRow, 'status' | 'consent_requested_at' | 'decided_at'>
  > = [];
  if (filter) {
    const { data, error } = await admin
      .from('referred_enquiries')
      .select('status, consent_requested_at, decided_at')
      .eq('account_id', args.accountId)
      .eq('via_contact_id', args.referrer.contactId)
      .or(filter)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.error('[referred-enquiries] Earlier lookup failed:', error);
      return 'undeliverable';
    }
    earlier = data ?? [];
  }

  const waiting = earlier.find((row) => row.status === 'pending');
  if (waiting) {
    const { error } = await admin.from('referred_enquiries').insert({
      ...base,
      status: 'pending',
      consent_requested_at: waiting.consent_requested_at,
    });
    if (error) {
      console.error('[referred-enquiries] Insert failed:', error);
      return 'undeliverable';
    }
    return 'pending';
  }

  const declinedRecently = earlier.some(
    (row) =>
      (row.status === 'rejected' || row.status === 'expired') &&
      row.decided_at !== null &&
      Date.now() - new Date(row.decided_at).getTime() < REPEAT_DECLINE_WINDOW_MS
  );
  if (declinedRecently) {
    const { error } = await admin.from('referred_enquiries').insert({
      ...base,
      status: 'rejected',
      decided_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[referred-enquiries] Insert failed:', error);
      return 'undeliverable';
    }
    if (args.source === 'whatsapp') {
      await redirectGuest(
        args.accountId,
        args.requesterPhone,
        await enquirySubject(admin, base)
      );
    }
    return 'closed';
  }

  const { data: inserted, error: insertError } = await admin
    .from('referred_enquiries')
    .insert({
      ...base,
      status: 'pending',
      consent_requested_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (insertError || !inserted) {
    console.error('[referred-enquiries] Insert failed:', insertError);
    return 'undeliverable';
  }
  const row = inserted as ReferredEnquiryRow;
  const subject = await enquirySubject(admin, row);

  const asked = await askReferrer(admin, row, args.referrer, subject);
  if (!asked) {
    await admin
      .from('referred_enquiries')
      .update({ status: 'approved', decided_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('account_id', args.accountId);
    return 'undeliverable';
  }

  await notifyListingSide({
    accountId: args.accountId,
    userId: notifyUserId(row),
    title: `${args.referrer.name}'s guest enquired`,
    body:
      `${maskedGuest(row.requester_name, row.requester_phone)} asked for details on ${subject} through the link you shared with ${args.referrer.name}. ` +
      `Waiting for ${args.referrer.name} to approve. Their details stay private until then, and no answer in 2 hours closes the enquiry.`,
    contactId: args.referrer.contactId,
  });
  return 'pending';
}

/** Claims every waiting enquiry of one guest under one referrer, so a
 *  decision, a second tap and the timeout sweep cannot each act on the
 *  same rows. Returns the rows this call moved out of pending. */
async function claimGuestRows(
  admin: SupabaseClient,
  row: Pick<
    ReferredEnquiryRow,
    'id' | 'account_id' | 'via_contact_id' | 'requester_phone' | 'session_key'
  >,
  status: Exclude<ReferredEnquiryStatus, 'pending'>
): Promise<ReferredEnquiryRow[]> {
  const filter = guestFilter(row);
  const query = admin
    .from('referred_enquiries')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('account_id', row.account_id)
    .eq('via_contact_id', row.via_contact_id)
    .eq('status', 'pending');
  const { data, error } = await (
    filter ? query.or(filter) : query.eq('id', row.id)
  ).select('*');
  if (error) {
    console.error('[referred-enquiries] Claim failed:', error);
    return [];
  }
  return (data ?? []) as ReferredEnquiryRow[];
}

async function fileApprovedRow(
  admin: SupabaseClient,
  row: ReferredEnquiryRow,
  referrer: ShowcaseReferrer,
  subject: string
): Promise<void> {
  if (row.source === 'website') {
    const payload = row.payload as ShowcaseInquiryInput;
    const { contactId } = await fileShowcaseInquiry(admin, {
      ...payload,
      referrerContactId: referrer.contactId,
    });
    await admin
      .from('referred_enquiries')
      .update({ contact_id: contactId })
      .eq('id', row.id)
      .eq('account_id', row.account_id);
    // The number may already belong to a hidden contact, left by an
    // earlier decline or by the location flow. Approval makes them a
    // lead, so they must be visible as one.
    const { error: visibleError } = await admin
      .from('contacts')
      .update({ chain_only: false })
      .eq('id', contactId)
      .eq('account_id', row.account_id);
    if (visibleError) throw visibleError;
    await notifyListingSide({
      accountId: row.account_id,
      userId: payload.targetAgentUserId,
      title: `${referrer.name} approved: ${row.requester_name} is your lead`,
      body: `${row.requester_name} (${row.requester_phone}) enquired about ${subject}. Referred by ${referrer.name}.`,
      contactId,
    });
    return;
  }

  if (!row.contact_id || !row.conversation_id) return;
  const payload = row.payload as WhatsAppEnquiryPayload;
  await revealWhatsAppGuest(admin, {
    accountId: row.account_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    referrerContactId: referrer.contactId,
  });
  if (!row.property_id) return;
  await admin.from('contact_property_inquiries').upsert(
    {
      account_id: row.account_id,
      contact_id: row.contact_id,
      property_id: row.property_id,
      inquiry_source: 'WhatsApp',
      inquiry_date: new Date().toISOString(),
      notes: payload.enquiryText.slice(0, 500),
    },
    { onConflict: 'contact_id,property_id' }
  );
  await alertAgentOfPropertyEnquiry({
    db: admin,
    accountId: row.account_id,
    agentUserId: payload.targetAgentUserId,
    propertyId: row.property_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    leadName: row.requester_name,
    leadPhone: row.requester_phone,
    enquiryText: payload.enquiryText,
    referredByName: referrer.name,
  });
}

async function closeGuestRows(
  admin: SupabaseClient,
  rows: ReferredEnquiryRow[],
  reason: 'rejected' | 'expired'
): Promise<void> {
  const first = rows[0];
  const subject = await enquirySubject(admin, first);
  const { data: referrer } = await admin
    .from('contacts')
    .select('name')
    .eq('id', first.via_contact_id)
    .eq('account_id', first.account_id)
    .maybeSingle();
  const referrerName = ((referrer?.name as string) || '').trim() || 'the agent';

  // A guest who only filled in the showcase form has never messaged
  // this number, so WhatsApp refuses a free-form text to them. The
  // listing side and the agent are told when that happens: the agent
  // is then the only one who can let their guest know.
  const phones = [...new Set(rows.map((row) => row.requester_phone))];
  let told = true;
  for (const phone of phones) {
    told = (await redirectGuest(first.account_id, phone, subject)) && told;
  }

  await notifyListingSide({
    accountId: first.account_id,
    userId: notifyUserId(first),
    title:
      reason === 'rejected'
        ? `${referrerName} declined a guest enquiry`
        : `No answer from ${referrerName} on a guest enquiry`,
    body: told
      ? `${maskedGuest(first.requester_name, first.requester_phone)} was asked to speak with ${referrerName} about ${subject}. Their details stay private.`
      : `${maskedGuest(first.requester_name, first.requester_phone)} enquired about ${subject} and could not be messaged on WhatsApp, so ${referrerName} has been asked to follow up with them. Their details stay private.`,
    contactId: first.via_contact_id,
  });

  const followUp = told
    ? `They have been asked to speak with you about *${subject}*.`
    : `We could not message them on WhatsApp, so please follow up with them about *${subject}* yourself.`;
  await sendToReferrer(
    first,
    reason === 'rejected'
      ? `👍 Noted. We will not contact them. ${followUp}`
      : `⏳ The enquiry from the link we shared with you has closed without an answer. ${followUp}`
  );
}

/**
 * Handles the agent's Approve / Decline tap. Returns true when the
 * reply targeted a referred enquiry and is fully handled. Only the
 * agent the link was shared with may decide: a forwarded button tapped
 * by anyone else is ignored, and so is a tap on an enquiry that has
 * already been decided or has timed out.
 */
export async function handleReferredEnquiryReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const parsed = parseReferredReply(args.replyId);
  if (!parsed) return false;

  const { data } = await args.admin
    .from('referred_enquiries')
    .select('*')
    .eq('id', parsed.requestId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  const row = data as ReferredEnquiryRow | null;
  if (!row) return true;
  // The buttons name one enquiry, but the answer covers every waiting
  // enquiry of that guest. So a second Approve on an enquiry already
  // approved still counts while another of theirs is waiting, which is
  // how the agent retries one that could not be filed.
  const retry = row.status === 'approved' && parsed.decision === 'approve';
  if (row.status !== 'pending' && !retry) return true;

  const { data: via } = await args.admin
    .from('contacts')
    .select('id, name, phone, classification')
    .eq('id', row.via_contact_id)
    .eq('account_id', args.accountId)
    .maybeSingle();
  if (!via?.phone || !phonesMatch(via.phone as string, args.senderPhone)) {
    return true;
  }
  const referrer: ShowcaseReferrer = {
    contactId: via.id as string,
    name: ((via.name as string) || '').trim() || 'An agent',
    phone: via.phone as string,
    isAgent: via.classification === 'Agent',
  };

  const rows = await claimGuestRows(
    args.admin,
    row,
    parsed.decision === 'approve' ? 'approved' : 'rejected'
  );
  if (rows.length === 0) return true;

  if (parsed.decision === 'decline') {
    await closeGuestRows(args.admin, rows, 'rejected');
    return true;
  }

  // A row that could not be filed goes back to waiting, with its
  // original deadline: the agent can tap Approve again, and the sweep
  // closes it if they do not. An approval is only confirmed for what
  // was actually filed, and only when all of it was.
  const subject = await enquirySubject(args.admin, rows[0]);
  let filed = 0;
  for (const claimed of rows) {
    try {
      await fileApprovedRow(
        args.admin,
        claimed,
        referrer,
        await enquirySubject(args.admin, claimed)
      );
      filed += 1;
    } catch (err) {
      console.error('[referred-enquiries] Filing approved row failed:', err);
      await args.admin
        .from('referred_enquiries')
        .update({ status: 'pending', decided_at: null })
        .eq('id', claimed.id)
        .eq('account_id', args.accountId);
    }
  }
  await sendToReferrer(
    row,
    filed === rows.length
      ? `👍 Thanks, approved. Our team will take the enquiry on *${subject}* forward with them, and you are recorded as the referrer.`
      : `⚠️ Your approval for the enquiry on *${subject}* could not be recorded just now. Please tap Approve again in a few minutes.`
  );
  return true;
}

/**
 * Closes enquiries whose agent has not answered within two hours. Each
 * guest is pointed back to the agent, exactly as on a decline. Returns
 * the number of enquiries closed.
 */
export async function sweepReferredEnquiryTimeouts(
  admin: SupabaseClient
): Promise<number> {
  const cutoff = new Date(
    Date.now() - REFERRAL_CONSENT_TIMEOUT_MS
  ).toISOString();
  const { data } = await admin
    .from('referred_enquiries')
    .select('id, account_id, via_contact_id, requester_phone, session_key')
    .eq('status', 'pending')
    .lt('consent_requested_at', cutoff)
    .order('consent_requested_at', { ascending: true })
    .limit(50);

  let closed = 0;
  for (const row of (data ?? []) as Array<
    Pick<
      ReferredEnquiryRow,
      'id' | 'account_id' | 'via_contact_id' | 'requester_phone' | 'session_key'
    >
  >) {
    const rows = await claimGuestRows(admin, row, 'expired');
    if (rows.length === 0) continue;
    await closeGuestRows(admin, rows, 'expired');
    closed += rows.length;
  }
  return closed;
}

/**
 * Keeps a WhatsApp guest out of the listing side's view while their
 * enquiry is held: the contact carries no lead status, the thread is
 * archived and unread-free, and the enquiry the webhook pinned to the
 * contact is withdrawn until the agent approves.
 */
export async function hideWhatsAppGuest(
  admin: SupabaseClient,
  args: { accountId: string; contactId: string; conversationId: string }
): Promise<void> {
  await admin
    .from('contacts')
    .update({ chain_only: true, updated_at: new Date().toISOString() })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  await quietGuestThread(admin, args);
  await admin
    .from('contact_property_inquiries')
    .delete()
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId);
}

/** Makes a held WhatsApp guest an ordinary lead credited to the
 *  referrer: back in the contacts list, thread back in the inbox. */
export async function revealWhatsAppGuest(
  admin: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    conversationId: string;
    referrerContactId: string;
  }
): Promise<void> {
  const { error: contactError } = await admin
    .from('contacts')
    .update({
      chain_only: false,
      referrer_contact_id: args.referrerContactId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  if (contactError) throw contactError;
  const { error: threadError } = await admin
    .from('conversations')
    .update({
      is_archived: false,
      unread_count: 1,
      awaiting_reply: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId);
  if (threadError) throw threadError;
}

export async function quietGuestThread(
  admin: SupabaseClient,
  args: { accountId: string; conversationId: string }
): Promise<void> {
  await admin
    .from('conversations')
    .update({
      is_archived: true,
      unread_count: 0,
      awaiting_reply: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId);
}
