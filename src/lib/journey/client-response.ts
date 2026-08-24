/**
 * Client responses captured from forwarded chat screenshots.
 *
 * Clients often answer a journey check-in on the agent's PERSONAL
 * WhatsApp. When the agent forwards that screenshot to the Engine, the
 * owner chatbot classifies it 'client_reply' (gemini.ts) and hands the
 * parsed response here to:
 *   - match it to an existing contact and property,
 *   - log a 'client_response' event on the contact×property journey
 *     item (creating the item at the first stage when the pair was
 *     never captured),
 *   - mirror it into contact notes and any active pipeline deal's
 *     notes, and notify the agent in-app,
 *   - ask the client (via the business number, only inside the 24-hour
 *     window) when to expect their update, with quick-reply buttons.
 *
 * The button taps come back through the webhook as interactive replies
 * with a `jfu_` id and land in handleClientFollowupReply, which stamps
 * the journey item's planned step, creates a follow-up to-do, acks the
 * client and notifies the agent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';

import type { ParsedClientReply } from '@/lib/ai/gemini';
import { DEFAULT_JOURNEY_STAGES } from '@/components/journey/shared';
import {
  matchContactByExactName,
  matchContactByName,
  type BookContact,
} from '@/lib/contacts/draft-match';
import { looksLikeQuestion } from '@/lib/ai/lead-question';
import { appendRequirement } from '@/lib/ai/buyer-qualification';
import { carriesRequirementSignal } from '@/lib/ai/requirement-signal';
import { syncContactPreferences } from '@/lib/contacts/preference-sync';
import {
  CLIENT_QUESTION_PROMPT,
  parsePropertyOwnerName,
} from '@/lib/journey/client-answer';
import { parseCheckBackDate, quietUntilFrom } from '@/lib/journey/pitch-quiet';
import {
  distinctiveTerms,
  rankClientCandidates,
  type CandidateContact,
  type CandidateEvidence,
  type RankedCandidate,
} from '@/lib/journey/client-candidates';
import { scanMessagesForProperties } from '@/lib/journey/chat-scan';
import { createNotification } from '@/lib/notifications/create';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { sendInteractiveButtons } from '@/lib/whatsapp/meta-api';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import {
  extractLoggedSummary,
  PROPERTY_QUESTION_PROMPT,
  type PropertyAnswer,
} from '@/lib/journey/property-answer';
import { resolveConversation } from '@/lib/conversations/resolve';
import { DEFAULT_LANGUAGE, type LanguageCode } from '@/lib/languages';
import { resolveSendLanguage } from '@/lib/whatsapp/template-language';
import {
  matchTemplateButton,
  templateButtonLabel,
} from '@/lib/whatsapp/template-copy';
import {
  timelineButtonAction,
  timelineChoiceForAction,
  timelineTemplateParams,
  DEFAULT_FOLLOWUP_DAYS,
  TIMELINE_ASK_TEMPLATE_NAMES,
  TIMELINE_CHOICES,
  type TimelineChoice,
} from '@/lib/whatsapp/timeline-ask-template';
import { pickApprovedTemplate } from '@/lib/whatsapp/pick-approved-template';
import { narrowToLanguage } from '@/lib/whatsapp/template-language';
import {
  rankJourneyPropertyCandidates,
  type RankedPropertyCandidate,
} from '@/lib/journey/property-candidates';

export const CLIENT_FOLLOWUP_PREFIX = 'jfu_';

/** The agent-facing twin of CLIENT_FOLLOWUP_PREFIX. Same three choices,
 *  same effect on the journey — but tapped by the staff member in their
 *  own bot chat, for the case where the client cannot be reached. */
export const AGENT_FOLLOWUP_PREFIX = 'jfa_';

export type ClientFollowupChoice = TimelineChoice;

const CLIENT_FOLLOWUP_ACKS: Record<ClientFollowupChoice, string> = {
  today: "👍 Great — we'll check back with you later today.",
  '2d': "👍 Noted — we'll check back with you in a couple of days.",
  unsure: "👍 No problem — take your time. We're here whenever you're ready.",
};

/** Free-form interactive buttons for the client, inside an open window.
 *  Labels come from the same registry the template buttons use, so a
 *  Kannada contact sees Kannada whichever path reaches them. */
export function buildClientFollowupButtons(
  itemId: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): Array<{ id: string; title: string }> {
  return TIMELINE_CHOICES.map((choice) => ({
    id: `${CLIENT_FOLLOWUP_PREFIX}${choice}:${itemId}`,
    title: templateButtonLabel(timelineButtonAction(choice), language),
  }));
}

/** The agent's own copy of the same three buttons, for when the client
 *  cannot be reached. Always English: the staff member is talking to
 *  the Engine, not to their client. */
export function buildAgentFollowupButtons(
  itemId: string
): Array<{ id: string; title: string }> {
  return TIMELINE_CHOICES.map((choice) => ({
    id: `${AGENT_FOLLOWUP_PREFIX}${choice}:${itemId}`,
    title: templateButtonLabel(timelineButtonAction(choice), DEFAULT_LANGUAGE),
  }));
}

function parsePrefixedReplyId(
  replyId: string,
  prefix: string
): { choice: ClientFollowupChoice; itemId: string } | null {
  if (!replyId.startsWith(prefix)) return null;
  const [choice, itemId] = replyId.slice(prefix.length).split(':');
  if (!itemId) return null;
  if (choice !== 'today' && choice !== '2d' && choice !== 'unsure') return null;
  return { choice, itemId };
}

export function parseClientFollowupReplyId(
  replyId: string
): { choice: ClientFollowupChoice; itemId: string } | null {
  return parsePrefixedReplyId(replyId, CLIENT_FOLLOWUP_PREFIX);
}

export function parseAgentFollowupReplyId(
  replyId: string
): { choice: ClientFollowupChoice; itemId: string } | null {
  return parsePrefixedReplyId(replyId, AGENT_FOLLOWUP_PREFIX);
}

/** When the agent should follow up for a given choice; null when the
 *  client can't commit to a date. */
export function followupDueDate(
  choice: ClientFollowupChoice,
  now: Date = new Date()
): Date | null {
  if (choice === 'today') return now;
  if (choice === '2d') return addDays(now, 2);
  return null;
}

export function propertyLabel(p: {
  title?: string | null;
  property_code?: string | null;
}): string {
  const title = (p.title || '').trim();
  const code = (p.property_code || '').trim();
  if (title && code) return `${title} (${code})`;
  return title || code || 'the property';
}

function firstName(name?: string | null): string | null {
  const first = (name || '').trim().split(/\s+/)[0];
  return first || null;
}

export function buildClientAskBody(args: {
  contactName?: string | null;
  propertyLabel: string;
  responseSummary?: string | null;
}): string {
  const first = firstName(args.contactName);
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const noted = args.responseSummary
    ? ` noted your update on ${args.propertyLabel}: "${args.responseSummary}"`
    : ` thanks for your update on ${args.propertyLabel}.`;
  return `${greeting}${noted}\n\nWhen should we check back with you?`;
}

/** The timeline question, found again in a stored bot message —
 *  free-form ("When should we check back with you?") or the approved
 *  template's own wording. */
export const TIMELINE_ASK_FINGERPRINT =
  /when should we check back with you|when we should check back/i;

export interface TypedCheckBackArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  /** What the client typed. */
  text: string;
  /** The bot message immediately before it. */
  previousBotText: string | null | undefined;
  now?: Date;
}

/**
 * A client who answers the timeline question in words rather than by
 * tapping one of the three buttons.
 *
 * Everyone does this — "By the 5th of September" — and until now it
 * landed nowhere: no acknowledgement, no follow-up date, and the next
 * thing they heard was a new listing. Returns the line to send back, or
 * null when the standing question is not the timeline one.
 */
export async function captureTypedCheckBack(
  args: TypedCheckBackArgs
): Promise<string | null> {
  if (!TIMELINE_ASK_FINGERPRINT.test(args.previousBotText || '')) return null;
  const now = args.now ?? new Date();
  const named = parseCheckBackDate(args.text, now);
  const until = quietUntilFrom(named, now);

  const { error } = await args.db
    .from('contacts')
    .update({ pitch_quiet_until: until.toISOString() })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);
  if (error) {
    console.error('[client-response] typed quiet window failed:', error.message);
    return null;
  }

  return named
    ? `👍 Noted — we'll check back with you around ${format(named, 'd MMMM')}.`
    : "👍 No problem — take your time. We're here whenever you're ready.";
}

export type ClientAskOutcome =
  | 'sent'
  | 'sent_template'
  | 'window_closed'
  | 'no_phone'
  | 'failed';

/** The line that says a stated requirement was filed, or nothing. */
export function buildRequirementLine(
  contactName: string,
  requirement: string | null
): string {
  if (!requirement) return '';
  return (
    `\n\n🎯 Also saved to ${contactName}'s requirements — _"${requirement}"_ — ` +
    'so matching, Radar and their digest read it now.'
  );
}

export function buildAgentReply(args: {
  contactName: string;
  propertyLabel: string;
  responseSummary: string | null;
  stageName: string | null;
  dealsUpdated: number;
  askOutcome: ClientAskOutcome;
  capturedRequirement?: string | null;
  reminderDate?: string | null;
  ownerNotice?: 'sent' | 'not_found' | 'no_phone' | 'failed' | 'same_contact';
}): string {
  const first = firstName(args.contactName) || args.contactName;
  let reply =
    `✅ *Logged ${args.contactName}'s response* on ${args.propertyLabel}` +
    (args.stageName ? ` — at *${args.stageName}*` : '') +
    '.';
  if (args.responseSummary) {
    reply += `\n_"${args.responseSummary}"_`;
  }
  reply +=
    '\n\n📒 Saved to the journey timeline and contact notes' +
    (args.dealsUpdated > 0 ? ' and the pipeline deal' : '') +
    '.';
  reply += buildRequirementLine(
    args.contactName,
    args.capturedRequirement ?? null
  );
  if (args.reminderDate) {
    reply += `\n📅 Follow-up reminder created for *${args.reminderDate}*.`;
  }
  if (args.ownerNotice === 'sent') {
    reply += `\n✉️ The property owner was informed on WhatsApp.`;
  } else if (args.ownerNotice === 'not_found') {
    reply += `\n⚠️ The named property owner was not found in Contacts.`;
  } else if (args.ownerNotice === 'no_phone') {
    reply += `\n⚠️ The property owner has no WhatsApp number in Contacts.`;
  } else if (args.ownerNotice === 'failed') {
    reply += `\n⚠️ The owner message could not be delivered; the reminder remains active.`;
  }
  if (args.askOutcome === 'sent' || args.askOutcome === 'sent_template') {
    reply += `\n✉️ Asked ${first} when to expect their update — Today itself / In 2 days / Can't say yet. I'll log their answer and set a follow-up for you.`;
  } else if (args.askOutcome === 'window_closed') {
    reply += `\n⏳ Couldn't ask ${first} directly — their 24-hour window is closed and the *Enquiry timeline* template isn't approved on this account yet.`;
  } else if (args.askOutcome === 'no_phone') {
    reply += `\n⏳ Couldn't message ${first} — no phone number on their contact.`;
  } else {
    reply += `\n⚠️ Couldn't reach ${first} on WhatsApp just now.`;
  }
  // Whoever answers first sets the date: the client's own tap when it
  // arrives, this one when it does not.
  reply += `\n\n📅 When should I remind you to follow up?`;
  return reply;
}

/** A tap that names the client a parked forward is about. */
export const CLIENT_CANDIDATE_PREFIX = 'jcc_';

export function parseClientCandidateReplyId(replyId: string): string | null {
  if (!replyId.startsWith(CLIENT_CANDIDATE_PREFIX)) return null;
  return replyId.slice(CLIENT_CANDIDATE_PREFIX.length) || null;
}

/** WhatsApp allows 20 characters on a button. A name cut mid-word is
 *  still the name the agent recognises; a rejected send is not. */
export function candidateButtonTitle(name: string | null): string {
  const clean = (name || 'Unknown').trim() || 'Unknown';
  return clean.length <= 20 ? clean : `${clean.slice(0, 19)}…`;
}

export function buildClientCandidateButtons(
  candidates: RankedCandidate[]
): Array<{ id: string; title: string }> {
  return candidates.slice(0, 3).map((c) => ({
    id: `${CLIENT_CANDIDATE_PREFIX}${c.contact.id}`,
    title: candidateButtonTitle(c.contact.name),
  }));
}

export const PROPERTY_CANDIDATE_PREFIX = 'jpc_';

export function parsePropertyCandidateReplyId(
  replyId: string
): { propertyId: string; contactId: string } | null {
  if (!replyId.startsWith(PROPERTY_CANDIDATE_PREFIX)) return null;
  const [propertyId, contactId] = replyId
    .slice(PROPERTY_CANDIDATE_PREFIX.length)
    .split(':');
  return propertyId && contactId ? { propertyId, contactId } : null;
}

export function buildPropertyCandidateButtons(
  contactId: string,
  candidates: RankedPropertyCandidate<PropertyRow & { title: string }>[]
): Array<{ id: string; title: string }> {
  return candidates.slice(0, 3).map(({ property }) => ({
    id: `${PROPERTY_CANDIDATE_PREFIX}${property.id}:${contactId}`,
    title: candidateButtonTitle(property.property_code || property.title),
  }));
}

export function buildPropertyCandidateReply(
  contactName: string,
  candidates: RankedPropertyCandidate<PropertyRow & { title: string }>[]
): string {
  return [
    `🔎 I found ${candidates.length} likely ${candidates.length === 1 ? 'property' : 'properties'} for ${contactName}.`,
    '',
    ...candidates.map(
      ({ property, reason }) =>
        `• *${property.title}*${property.property_code ? ` (${property.property_code})` : ''} — _${reason}_`
    ),
    '',
    'Tap the right property before I create the event, reminders or owner message.',
  ].join('\n');
}

/**
 * The who-question with the answers the thread already implies.
 *
 * Each name is offered with the reason it is being offered, so a tap is
 * a judgement rather than a guess — and typing a different name stays
 * open, because the right contact is often not among the three.
 */
export function buildCandidateReply(
  parsed: ParsedClientReply,
  candidates: RankedCandidate[]
): string {
  const lines = candidates.map(
    (c) =>
      `• *${c.contact.name || 'Unnamed contact'}*` +
      (c.reason ? ` — _${c.reason}_` : '')
  );
  return (
    "🤔 I read the conversation but couldn't work out who this client is." +
    (parsed.response_summary ? `\n_"${parsed.response_summary}"_` : '') +
    '\n\n*Is it one of these?*\n' +
    lines.join('\n') +
    "\n\nTap the right one — or reply with a different name as it's saved in your book."
  );
}

/**
 * The who-question, asked instead of ending the exchange.
 *
 * What the client said is parked and quotable, so the agent can see
 * the assistant did read the chat and only needs the person named —
 * rather than being told to forward the whole thing again.
 */
export function buildUnmatchedReply(parsed: ParsedClientReply): string {
  const who = parsed.client_name
    ? ` — *${parsed.client_name}* isn't in your book`
    : '';
  return (
    `🤔 I read the conversation but couldn't work out who this client is${who}.` +
    (parsed.response_summary ? `\n_"${parsed.response_summary}"_` : '') +
    `\n\n${CLIENT_QUESTION_PROMPT}`
  );
}

interface StageRow {
  id: string;
  name: string;
  position: number;
}

async function loadStages(
  db: SupabaseClient,
  accountId: string
): Promise<StageRow[]> {
  const load = async () => {
    const { data } = await db
      .from('journey_stages')
      .select('id, name, position')
      .eq('account_id', accountId)
      .order('position');
    return (data ?? []) as StageRow[];
  };
  let stages = await load();
  if (stages.length === 0) {
    const { error } = await db.from('journey_stages').insert(
      DEFAULT_JOURNEY_STAGES.map((s, idx) => ({
        account_id: accountId,
        name: s.name,
        color: s.color,
        position: idx,
        stage_kind: s.kind,
      }))
    );
    if (error)
      console.error(
        '[client-response] journey stage seed failed:',
        error.message
      );
    stages = await load();
  }
  return stages;
}

async function matchClientContact(
  db: SupabaseClient,
  accountId: string,
  parsed: ParsedClientReply,
  excludeContactId?: string
): Promise<BookContact | null> {
  const digits = (parsed.client_phone || '').replace(/\D/g, '');
  if (digits.length >= 7) {
    const suffix = digits.slice(-8);
    const { data } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .like('phone', `%${suffix}`);
    const hit = ((data ?? []) as BookContact[]).find(
      (c) =>
        c.id !== excludeContactId && c.phone && phonesMatch(c.phone, digits)
    );
    if (hit) return hit;
  }
  if (parsed.client_name) {
    const { data } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .eq('is_merged', false);
    return matchContactByName(
      parsed.client_name,
      ((data ?? []) as BookContact[]).filter((c) => c.id !== excludeContactId)
    );
  }
  return null;
}

interface PropertyRow {
  id: string;
  title: string | null;
  property_code: string | null;
  owner_contact_id?: string | null;
  listing_source?: string | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  type?: string | null;
  tags?: string[] | null;
}

interface ClientPropertyResolution {
  property: PropertyRow | null;
  candidates: RankedPropertyCandidate<PropertyRow & { title: string }>[];
}

async function resolveClientProperty(
  db: SupabaseClient,
  accountId: string,
  parsed: ParsedClientReply
): Promise<ClientPropertyResolution> {
  const select =
    'id, title, property_code, owner_contact_id, listing_source, location, sublocality, city, type, tags';
  const code = (parsed.property_code || '').trim();
  if (code) {
    const { data } = await db
      .from('properties')
      .select(select)
      .eq('account_id', accountId)
      .ilike('property_code', code)
      .limit(1)
      .maybeSingle();
    if (data) return { property: data as PropertyRow, candidates: [] };
  }
  const title = (parsed.property_title || '').trim().replace(/[.\s]+$/, '');
  if (title.length >= 8) {
    const escaped = title.replace(/([%_\\])/g, '\\$1');
    const { data } = await db
      .from('properties')
      .select(select)
      .eq('account_id', accountId)
      .ilike('title', `%${escaped}%`)
      .limit(2);
    if (data && data.length === 1) {
      return { property: data[0] as PropertyRow, candidates: [] };
    }
  }
  const { data } = await db
    .from('properties')
    .select(select)
    .eq('account_id', accountId)
    .limit(500);
  const properties = ((data ?? []) as PropertyRow[]).filter(
    (property): property is PropertyRow & { title: string } =>
      Boolean(property.title?.trim())
  );
  const query = [
    parsed.property_title,
    parsed.response_summary,
    parsed.requirement,
    ...(parsed.mentioned_terms || []),
  ]
    .filter(Boolean)
    .join(' ');
  return {
    property: null,
    candidates: rankJourneyPropertyCandidates(query, properties),
  };
}

async function matchClientProperty(
  db: SupabaseClient,
  accountId: string,
  parsed: ParsedClientReply
): Promise<PropertyRow | null> {
  return (await resolveClientProperty(db, accountId, parsed)).property;
}

interface ItemRow {
  id: string;
  stage_id: string;
  status: string;
  planned_at?: string | null;
}

async function ensureJourneyItem(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  propertyId: string,
  stages: StageRow[],
  captureReason: string
): Promise<ItemRow | null> {
  const read = async () => {
    const { data } = await db
      .from('journey_items')
      .select('id, stage_id, status, planned_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('property_id', propertyId)
      .maybeSingle();
    return (data ?? null) as ItemRow | null;
  };
  const existing = await read();
  if (existing) return existing;
  const firstStage = stages[0];
  if (!firstStage) return null;

  const { data: inserted, error } = await db
    .from('journey_items')
    .upsert(
      {
        account_id: accountId,
        contact_id: contactId,
        property_id: propertyId,
        stage_id: firstStage.id,
        source: 'chat_import',
        hidden: false,
        created_by: userId,
      },
      {
        onConflict: 'account_id,contact_id,property_id',
        ignoreDuplicates: true,
      }
    )
    .select('id, stage_id, status, planned_at');
  if (error) {
    console.error(
      '[client-response] journey item capture failed:',
      error.message
    );
    return read();
  }
  const created = (inserted ?? [])[0] as ItemRow | undefined;
  if (!created) return read();

  const { error: evError } = await db.from('journey_events').insert({
    account_id: accountId,
    item_id: created.id,
    event_type: 'added',
    to_stage_id: firstStage.id,
    reason: captureReason,
    created_by: userId,
  });
  if (evError)
    console.error('[client-response] capture event failed:', evError.message);
  return created;
}

/** Fills {{1}}-style placeholders so the inbox shows what was sent
 *  rather than the raw template body. */
function resolveTemplateBodyText(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const idx = parseInt(n, 10) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

/**
 * The closed-window path: the same question as an approved template.
 *
 * Two candidate names are in play (see timeline-ask-template.ts), so
 * the row is chosen by CATEGORY first — an approved Utility reminder
 * beats the approved Marketing row it replaces, and the upgrade
 * happens the moment Meta approves it, with no code change.
 *
 * Returns 'window_closed' unchanged when neither is approved: both are
 * submitted per-account and sit in Meta review, so this must degrade to
 * what the agent saw before rather than fail the capture.
 */
async function askClientViaTemplate(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: BookContact;
  conversationId: string;
  contactName: string | null;
  propertyLabel: string;
  itemId: string;
  language: LanguageCode;
}): Promise<ClientAskOutcome> {
  const { db, accountId, userId, contact, conversationId, language } = args;

  type Row = {
    name: string;
    language?: string | null;
    status?: string | null;
    category?: string | null;
    body_text: string;
  };
  const { data: rows } = await db
    .from('message_templates')
    .select('name, language, status, category, body_text')
    .eq('account_id', accountId)
    .in('name', TIMELINE_ASK_TEMPLATE_NAMES);
  const template = pickApprovedTemplate(
    narrowToLanguage((rows ?? []) as Row[], language),
    TIMELINE_ASK_TEMPLATE_NAMES
  );
  if (!template) return 'window_closed';

  const { data: account } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();

  // The reminder states a date, so the date has to be true before the
  // message goes out — stamp it on the journey item first. The buttons
  // then move an existing plan rather than creating one.
  const followUp = addDays(new Date(), DEFAULT_FOLLOWUP_DAYS);
  const followUpLabel = format(followUp, 'd MMM yyyy');
  await db
    .from('journey_items')
    .update({
      planned_at: format(followUp, 'yyyy-MM-dd'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.itemId)
    .eq('account_id', accountId);

  const params = timelineTemplateParams(template.name, {
    contactName: args.contactName,
    brandName: (account as { name?: string | null } | null)?.name ?? null,
    propertyDescription: args.propertyLabel,
    followUpDate: followUpLabel,
  });

  const res = await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId: contact.id,
    conversationId,
    kind: 'template',
    senderType: 'bot',
    templateName: template.name,
    templateLanguage: template.language || 'en_US',
    templateParams: [...params],
    messageParams: { body: [...params] },
    templateRow: template,
    text: resolveTemplateBodyText(template.body_text, [...params]),
    customDbClient: db,
  });
  return res.success ? 'sent_template' : 'failed';
}

async function askClientForTimeline(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: BookContact;
  itemId: string;
  bodyText: string;
  /** Template params for the closed-window fallback. */
  contactName: string | null;
  propertyLabel: string;
  accessToken: string;
  phoneNumberId: string;
}): Promise<ClientAskOutcome> {
  const {
    db,
    accountId,
    userId,
    contact,
    itemId,
    bodyText,
    accessToken,
    phoneNumberId,
  } = args;
  if (!contact.phone) return 'no_phone';

  const { conversation } = await resolveConversation<{ id: string }>(db, {
    accountId,
    contactId: contact.id,
    userId,
    columns: 'id',
  });
  if (!conversation) return 'failed';

  const { data: lastCustomer } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const language = await resolveSendLanguage(db, accountId, contact.id);

  // Outside the window free-form is refused by Meta, so the same
  // question goes out as the approved Utility template instead. It
  // carries the same three choices, and the tap comes back through
  // matchTemplateButton rather than as a button id.
  if (!isWithinCustomerWindow(lastCustomer?.created_at ?? null)) {
    return await askClientViaTemplate({
      db,
      accountId,
      userId,
      contact,
      conversationId: conversation.id,
      contactName: args.contactName,
      propertyLabel: args.propertyLabel,
      itemId,
      language,
    });
  }

  try {
    const sent = await sendInteractiveButtons({
      phoneNumberId,
      accessToken,
      to: contact.phone,
      bodyText,
      buttons: buildClientFollowupButtons(itemId, language),
    });
    const nowIso = new Date().toISOString();
    await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: bodyText,
      message_id: sent.messageId,
      status: 'sent',
    });
    await db
      .from('conversations')
      .update({
        last_message_text: bodyText,
        last_message_at: nowIso,
        updated_at: nowIso,
        awaiting_reply: false,
      })
      .eq('id', conversation.id);
    return 'sent';
  } catch (err) {
    console.error('[client-response] timeline ask failed:', err);
    return 'failed';
  }
}

async function appendDealNotes(
  db: SupabaseClient,
  contactId: string,
  propertyId: string,
  line: string
): Promise<number> {
  const { data: deals } = await db
    .from('deals')
    .select('id, notes')
    .eq('contact_id', contactId)
    .eq('property_id', propertyId)
    .eq('status', 'active');
  let updated = 0;
  for (const deal of (deals ?? []) as Array<{
    id: string;
    notes: string | null;
  }>) {
    const { error } = await db
      .from('deals')
      .update({
        notes: deal.notes ? `${deal.notes}\n${line}` : line,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deal.id);
    if (!error) updated++;
  }
  return updated;
}

export interface ProcessClientReplyArgs {
  db: SupabaseClient;
  accountId: string;
  /** Account owner's auth user id — audit trail + notification recipient. */
  userId: string;
  parsed: ParsedClientReply;
  accessToken: string;
  phoneNumberId: string;
  /** The forwarding agent's own contact row — never the client. */
  excludeContactId?: string;
}

/** What the forwarding agent gets back. `buttons` is present once the
 *  response is pinned to a journey item, so the agent can set their own
 *  reminder whether or not the client was reachable. */
export interface ClientReplyOutcome {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  /** Set when no contact could be matched: the parse is worth parking,
   *  because the agent's next message usually names the person. */
  unmatched?: boolean;
  /** Set when the response was logged but no listing could be matched:
   *  the contact the standing "which property?" question is about, so
   *  the caller can register it against the message it sends and the
   *  agent's next line can answer it. */
  pendingPropertyContactId?: string;
}

function escapeLike(term: string): string {
  return term.replace(/([%_,\\])/g, '\\$1');
}

/**
 * A term identifies somebody only if it belongs to almost nobody. More
 * contacts than this share it and it is vocabulary, not a name.
 */
const MAX_CONTACTS_PER_TERM = 3;

/** Terms worth asking the book about: what the client actually typed
 *  first, and only if they typed nothing nameable, the longer words of
 *  the summary. */
function candidateTerms(parsed: ParsedClientReply): string[] {
  const mentioned = (parsed.mentioned_terms || [])
    .flatMap((term) => term.split(/[^\p{L}\p{N}]+/u))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 5);
  const deduped = [...new Set(mentioned)].slice(0, 6);
  if (deduped.length) return deduped;
  return distinctiveTerms(
    [parsed.property_title, parsed.requirement, parsed.response_summary]
      .filter(Boolean)
      .join(' ')
  );
}

/** The contacts one term points at — or null when it points at too
 *  many to mean anything. Two bounded reads, no counting: a term that
 *  can fill the limit has already disqualified itself. */
async function contactsForTerm(
  db: SupabaseClient,
  accountId: string,
  term: string
): Promise<{ brief: string[]; noted: string[] } | null> {
  const needle = `%${escapeLike(term)}%`;
  const cap = MAX_CONTACTS_PER_TERM + 1;

  const [briefs, notes] = await Promise.all([
    db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_merged', false)
      .ilike('requirements', needle)
      .limit(cap),
    db
      .from('contact_notes')
      .select('contact_id')
      .eq('account_id', accountId)
      .ilike('note_text', needle)
      .limit(cap * 5),
  ]);

  const brief = new Set<string>();
  for (const row of briefs.data ?? []) brief.add(row.id as string);
  const noted = new Set<string>();
  for (const row of notes.data ?? []) {
    const id = row.contact_id as string;
    if (!brief.has(id)) noted.add(id);
  }
  const total = brief.size + noted.size;
  if (total === 0 || total > MAX_CONTACTS_PER_TERM) return null;
  return { brief: [...brief], noted: [...noted] };
}

/**
 * The handful of contacts a forward could plausibly be about.
 *
 * Runs only on the unmatched path. Each term is tested for rarity in
 * THIS account's book before it is allowed to nominate anybody, so a
 * word like "owner" — eleven contacts' notes carry it — nominates
 * nobody, while "Domlur" — one contact's brief carries it — nominates
 * them. An account whose book answers nothing yields nothing, and the
 * agent gets the plain question.
 */
export async function findClientCandidates(
  db: SupabaseClient,
  accountId: string,
  parsed: ParsedClientReply,
  /** The agent forwarding this. Their own contact row is never the
   *  client: the screenshot is taken inside their chat, so the app
   *  header at the top of it carries their name, and a model that
   *  reads it there would have them offered as their own client. */
  excludeContactId?: string
): Promise<RankedCandidate[]> {
  const evidence = new Map<string, CandidateEvidence>();
  const remember = (contact: CandidateContact): CandidateEvidence => {
    const existing = evidence.get(contact.id);
    if (existing) return existing;
    const fresh: CandidateEvidence = {
      contact,
      matchedTerms: [],
      notedTerms: [],
      nameMatched: false,
      phoneMatched: false,
    };
    evidence.set(contact.id, fresh);
    return fresh;
  };

  try {
    const nominated = new Map<string, { brief: string[]; noted: string[] }>();
    for (const term of candidateTerms(parsed)) {
      const hit = await contactsForTerm(db, accountId, term);
      if (hit) nominated.set(term, hit);
    }

    const wantedIds = new Set<string>();
    for (const hit of nominated.values()) {
      for (const id of [...hit.brief, ...hit.noted]) wantedIds.add(id);
    }

    if (wantedIds.size) {
      const { data } = await db
        .from('contacts')
        .select('id, name, phone, updated_at')
        .eq('account_id', accountId)
        .in('id', [...wantedIds].slice(0, 20));
      for (const row of data ?? []) {
        remember({
          id: row.id as string,
          name: row.name as string | null,
          phone: row.phone as string | null,
          lastActivity: row.updated_at as string | null,
        });
      }
      for (const [term, hit] of nominated) {
        for (const id of hit.brief) evidence.get(id)?.matchedTerms.push(term);
        for (const id of hit.noted) evidence.get(id)?.notedTerms?.push(term);
      }
    }

    const firstName = (parsed.client_name || '').trim().split(/\s+/)[0];
    if (firstName.length >= 3) {
      const { data } = await db
        .from('contacts')
        .select('id, name, phone, updated_at')
        .eq('account_id', accountId)
        .eq('is_merged', false)
        .ilike('name', `%${escapeLike(firstName)}%`)
        .limit(10);
      for (const row of data ?? []) {
        remember({
          id: row.id as string,
          name: row.name as string | null,
          phone: row.phone as string | null,
          lastActivity: row.updated_at as string | null,
        }).nameMatched = true;
      }
    }

    const digits = (parsed.client_phone || '').replace(/\D/g, '');
    if (digits.length >= 7) {
      for (const item of evidence.values()) {
        if (item.contact.phone && phonesMatch(item.contact.phone, digits)) {
          item.phoneMatched = true;
        }
      }
    }
  } catch (err) {
    console.error(
      '[client-response] candidate lookup failed:',
      err instanceof Error ? err.message : err
    );
  }

  if (excludeContactId) evidence.delete(excludeContactId);
  return rankClientCandidates([...evidence.values()]);
}

/**
 * Matches a parsed screenshot to the Engine's records, logs the response
 * everywhere it should surface, and asks the client for a timeline.
 * Returns the reply to show the forwarding agent. Never throws — a
 * partial failure degrades to what was actually logged.
 */
export async function processClientReplyScreenshot(
  args: ProcessClientReplyArgs
): Promise<ClientReplyOutcome> {
  const { db, accountId, userId, parsed, accessToken, phoneNumberId } = args;

  const contact = await matchClientContact(
    db,
    accountId,
    parsed,
    args.excludeContactId
  );
  if (!contact) {
    const candidates = await findClientCandidates(
      db,
      accountId,
      parsed,
      args.excludeContactId
    );
    if (candidates.length) {
      return {
        text: buildCandidateReply(parsed, candidates),
        buttons: buildClientCandidateButtons(candidates),
        unmatched: true,
      };
    }
    return { text: buildUnmatchedReply(parsed), unmatched: true };
  }

  return await logClientResponse({
    db,
    accountId,
    userId,
    contact,
    parsed,
    accessToken,
    phoneNumberId,
    relatedOwnerName: parsed.related_owner_name,
  });
}

/**
 * A forwarded reply often is not a status update at all: the client
 * has dropped the listing that was shared and said what they now want
 * — "1 acre near the airport, 8 to 10cr, direct purchase only". That
 * sentence used to survive only as a note, which the matcher does not
 * read, so the requirement it stated reached nothing: no match rows,
 * no radar, no digest.
 *
 * The brief is appended (never replaced — the client's earlier
 * criteria still stand until they say otherwise) and the pref_ columns
 * are re-extracted from it, the same path every other requirement
 * intake uses. Best-effort: a failure here leaves the response logged.
 */
async function captureStatedRequirement(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  requirement: string | null | undefined
): Promise<string | null> {
  const stated = (requirement || '').trim();
  if (!stated || !carriesRequirementSignal(stated)) return null;

  try {
    const { data: row } = await db
      .from('contacts')
      .select('requirements')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    const merged = appendRequirement(
      (row?.requirements as string | null) ?? null,
      stated
    );
    if (merged === ((row?.requirements as string | null) ?? '').trim()) {
      return null;
    }

    const { error } = await db
      .from('contacts')
      .update({ requirements: merged })
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (error) throw error;

    await syncContactPreferences(db, accountId, contactId);
    return stated;
  } catch (err) {
    console.error(
      '[client-response] requirement capture failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

interface LogArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: BookContact;
  parsed: ParsedClientReply;
  accessToken: string;
  phoneNumberId: string;
  relatedOwnerName?: string | null;
}

/**
 * Everything that follows knowing WHOSE response this is. Split out
 * because the contact can arrive later: the agent naming the client
 * runs exactly this against the parked parse, minutes after the
 * screenshot itself was read.
 */
async function logClientResponse(args: LogArgs): Promise<ClientReplyOutcome> {
  const { db, accountId, userId, contact, parsed, accessToken, phoneNumberId } =
    args;
  const contactName = contact.name || parsed.client_name || 'Client';

  const propertyResolution = await resolveClientProperty(db, accountId, parsed);
  const property = propertyResolution.property;
  const summary = parsed.response_summary || parsed.next_action || null;
  const label = property
    ? propertyLabel(property)
    : parsed.property_title || parsed.property_code || 'the property';

  const noteText =
    `💬 ${contactName} on ${label}: ` +
    (summary ? `"${summary}"` : 'responded') +
    ' (from forwarded chat)';
  const { error: noteError } = await db.from('contact_notes').insert({
    contact_id: contact.id,
    account_id: accountId,
    user_id: userId,
    note_text: noteText,
  });
  if (noteError)
    console.error('[client-response] contact note failed:', noteError.message);

  const capturedRequirement = await captureStatedRequirement(
    db,
    accountId,
    contact.id,
    parsed.requirement
  );

  await createNotification({
    accountId,
    userId,
    type: 'new_message',
    title: `💬 ${contactName} responded on ${label}`,
    body: summary,
    entityType: 'contact',
    entityId: contact.id,
    link: `/journey?contact=${contact.id}`,
    channels: { inApp: true, push: true, whatsapp: false },
  });

  if (!property) {
    // A brief names no listing because there isn't one yet — that is
    // the whole point of it. Asking "which property is this about?"
    // there is a question with no answer; the matcher has the brief
    // now and that is what to say.
    if (capturedRequirement) {
      return {
        text:
          `✅ *Logged ${contactName}'s requirement*` +
          buildRequirementLine(contactName, capturedRequirement) +
          `\n\n🔎 Open their contact to see what in your inventory fits.`,
      };
    }
    if (propertyResolution.candidates.length) {
      return {
        text: buildPropertyCandidateReply(
          contactName,
          propertyResolution.candidates
        ),
        buttons: buildPropertyCandidateButtons(
          contact.id,
          propertyResolution.candidates
        ),
      };
    }
    return {
      text:
        `✅ *Logged ${contactName}'s response*` +
        (summary ? `:\n_"${summary}"_` : '.') +
        `\n\n📒 Saved to their contact notes — but ${PROPERTY_QUESTION_PROMPT}`,
      pendingPropertyContactId: contact.id,
    };
  }

  return await linkClientResponseToProperty({
    db,
    accountId,
    capturedRequirement,
    userId,
    contact,
    contactName,
    property,
    label,
    summary,
    accessToken,
    phoneNumberId,
    relatedOwnerName: args.relatedOwnerName,
  });
}

interface LinkArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: BookContact;
  contactName: string;
  property: PropertyRow;
  label: string;
  summary: string | null;
  /** A requirement this reply stated, already written to the contact. */
  capturedRequirement?: string | null;
  accessToken: string;
  phoneNumberId: string;
  relatedOwnerName?: string | null;
}

async function ensureDefaultFollowup(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  item: ItemRow;
  contactId: string;
  contactName: string;
  propertyId: string;
  label: string;
}): Promise<string> {
  const due = args.item.planned_at
    ? new Date(`${args.item.planned_at}T12:00:00`)
    : addDays(new Date(), DEFAULT_FOLLOWUP_DAYS);
  if (!args.item.planned_at) {
    await args.db
      .from('journey_items')
      .update({
        planned_at: format(due, 'yyyy-MM-dd'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.item.id)
      .eq('account_id', args.accountId);
  }

  const { data: existing } = await args.db
    .from('todos')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('property_id', args.propertyId)
    .eq('completed', false)
    .eq('source', 'system')
    .limit(1)
    .maybeSingle();
  if (!existing) {
    const { error } = await args.db.from('todos').insert({
      account_id: args.accountId,
      user_id: args.userId,
      assigned_to: args.userId,
      title: `Follow up with ${args.contactName} — ${args.label}`,
      due_date: due.toISOString(),
      priority: 'medium',
      completed: false,
      contact_id: args.contactId,
      property_id: args.propertyId,
      source: 'system',
    });
    if (error)
      console.error('[client-response] default follow-up failed:', error.message);
  }
  return format(due, 'd MMM yyyy');
}

async function notifyPropertyOwner(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  property: PropertyRow;
  client: BookContact;
  clientName: string;
  relatedOwnerName?: string | null;
  label: string;
  summary: string | null;
}): Promise<'sent' | 'not_found' | 'no_phone' | 'failed' | 'same_contact'> {
  let owner: BookContact | null = null;
  if (args.relatedOwnerName) {
    const { data } = await args.db
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', args.accountId)
      .eq('is_merged', false);
    const book = (data ?? []) as BookContact[];
    owner =
      matchContactByExactName(args.relatedOwnerName, book) ??
      matchContactByName(args.relatedOwnerName, book);
  } else if (
    args.property.owner_contact_id &&
    args.property.listing_source !== 'agent'
  ) {
    const { data } = await args.db
      .from('contacts')
      .select('id, name, phone')
      .eq('id', args.property.owner_contact_id)
      .eq('account_id', args.accountId)
      .maybeSingle();
    owner = (data as BookContact | null) ?? null;
  }
  if (!owner) return 'not_found';
  if (owner.id === args.client.id) return 'same_contact';
  if (!owner.phone) return 'no_phone';

  const text = [
    `Hi ${(owner.name || 'there').trim().split(/\s+/)[0]}, an enquiry update was recorded for *${args.label}* through ${args.clientName}.`,
    args.summary ? `_${args.summary}_` : '',
    '',
    'The enquiry and follow-up are now being tracked in ConvoReal. Reply here if you want to add an owner-side update.',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: owner.id,
      kind: 'text',
      senderType: 'bot',
      text,
      customDbClient: args.db,
    });
    return result.success ? 'sent' : 'failed';
  } catch (err) {
    console.error('[client-response] owner notice failed:', err);
    return 'failed';
  }
}

/**
 * Everything that follows knowing WHICH listing a logged response is
 * about: the journey item and its event, the client's timeline ask,
 * and the deal notes. Split out because the property can arrive later
 * — the agent answering "which property?" runs exactly this, minutes
 * after the response itself was logged.
 */
async function linkClientResponseToProperty(
  args: LinkArgs
): Promise<ClientReplyOutcome> {
  const {
    db,
    accountId,
    userId,
    contact,
    contactName,
    property,
    label,
    summary,
    accessToken,
    phoneNumberId,
  } = args;

  const stages = await loadStages(db, accountId);
  const item = await ensureJourneyItem(
    db,
    accountId,
    userId,
    contact.id,
    property.id,
    stages,
    'Captured from forwarded chat screenshot'
  );
  let stageName: string | null = null;
  let askOutcome: ClientAskOutcome = 'failed';
  let reminderDate: string | null = null;
  let ownerNotice:
    | 'sent'
    | 'not_found'
    | 'no_phone'
    | 'failed'
    | 'same_contact' = 'not_found';
  if (item) {
    stageName = stages.find((s) => s.id === item.stage_id)?.name ?? null;
    const { error: evError } = await db.from('journey_events').insert({
      account_id: accountId,
      item_id: item.id,
      event_type: 'client_response',
      reason: summary ?? 'Client responded (from forwarded chat)',
      created_by: userId,
    });
    if (evError)
      console.error('[client-response] event insert failed:', evError.message);
    await db
      .from('journey_items')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', item.id);

    reminderDate = await ensureDefaultFollowup({
      db,
      accountId,
      userId,
      item,
      contactId: contact.id,
      contactName,
      propertyId: property.id,
      label,
    });

    ownerNotice = await notifyPropertyOwner({
      db,
      accountId,
      userId,
      property,
      client: contact,
      clientName: contactName,
      relatedOwnerName: args.relatedOwnerName,
      label,
      summary,
    });

    askOutcome = await askClientForTimeline({
      db,
      accountId,
      userId,
      contact,
      itemId: item.id,
      bodyText: buildClientAskBody({
        contactName,
        propertyLabel: label,
        responseSummary: summary,
      }),
      contactName,
      propertyLabel: label,
      accessToken,
      phoneNumberId,
    });
  }

  const dealsUpdated = await appendDealNotes(
    db,
    contact.id,
    property.id,
    `[${format(new Date(), 'd MMM yyyy')}] Client response: ${summary ?? 'responded (from forwarded chat)'}`
  );

  return {
    text: buildAgentReply({
      contactName,
      propertyLabel: label,
      responseSummary: summary,
      stageName,
      dealsUpdated,
      askOutcome,
      capturedRequirement: args.capturedRequirement ?? null,
      reminderDate,
      ownerNotice,
    }),
    buttons: item ? buildAgentFollowupButtons(item.id) : undefined,
  };
}

export interface CompleteClientTapArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  /** The contact the agent tapped. */
  contactId: string;
  parsed: ParsedClientReply;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * The agent's tap on one of the offered names. Same logging as a typed
 * answer; the id names the contact outright, so nothing is resolved.
 * Returns null when the contact is gone from the book.
 */
export async function completeClientReplyForContactId(
  args: CompleteClientTapArgs
): Promise<ClientReplyOutcome | null> {
  const { data } = await args.db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  if (!data) return null;
  const contact = data as BookContact;

  return await logClientResponse({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    contact,
    parsed: {
      ...args.parsed,
      client_name: args.parsed.client_name || contact.name,
    },
    accessToken: args.accessToken,
    phoneNumberId: args.phoneNumberId,
    relatedOwnerName: args.parsed.related_owner_name,
  });
}

export interface CompleteClientAnswerArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  /** The name the agent typed back at the who-question. */
  name: string;
  /** The parse parked when the screenshot named nobody matchable. */
  parsed: ParsedClientReply;
  accessToken: string;
  phoneNumberId: string;
  /** The forwarding agent's own contact row — never the client. */
  excludeContactId?: string;
}

/**
 * The agent's answer to "who is this client?".
 *
 * Resolves the typed name against the book and runs the logging the
 * screenshot could not. Returns null when the name resolves to no
 * contact — or to more than one, which is the same answer here: the
 * caller reports it rather than guessing, because a response filed
 * onto the wrong client is worse than one not filed at all.
 */
export async function completeClientReplyContact(
  args: CompleteClientAnswerArgs
): Promise<ClientReplyOutcome | null> {
  const { db, accountId, userId, name, parsed } = args;

  const { data } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('account_id', accountId)
    .eq('is_merged', false);
  const book = ((data ?? []) as BookContact[]).filter(
    (c) => c.id !== args.excludeContactId
  );

  const contact =
    matchContactByExactName(name, book) ?? matchContactByName(name, book);
  if (!contact) return null;

  return await logClientResponse({
    db,
    accountId,
    userId,
    contact,
    parsed: { ...parsed, client_name: parsed.client_name || contact.name },
    accessToken: args.accessToken,
    phoneNumberId: args.phoneNumberId,
    relatedOwnerName: parsed.related_owner_name,
  });
}

export interface CompletePropertyAnswerArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  /** The contact whose logged response is waiting for its listing. */
  contactId: string;
  answer: PropertyAnswer;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * The agent's answer to "which property is this about?".
 *
 * The response was already logged against the contact; all that was
 * missing is the listing, so this resolves it and runs the half that
 * was skipped. Returns null when the named listing cannot be resolved,
 * which the caller reports rather than guessing — a journey update
 * filed against the wrong listing is worse than none.
 */
export async function completeClientResponseProperty(
  args: CompletePropertyAnswerArgs
): Promise<ClientReplyOutcome | null> {
  const { db, accountId, userId, contactId, answer } = args;

  const { data: contactRow } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!contactRow) return null;
  const contact = contactRow as BookContact;

  const property = await matchClientProperty(db, accountId, {
    property_code: answer.code ?? null,
    property_title: answer.title ?? null,
  } as ParsedClientReply);
  if (!property) return null;

  // What the client actually said, recovered from the note written when
  // the response was logged — so the journey event and the client's
  // timeline ask read the same as they would have on the first pass.
  const { data: notes } = await db
    .from('contact_notes')
    .select('note_text')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(5);
  const summary =
    (notes ?? [])
      .map((n) => extractLoggedSummary(n.note_text as string))
      .find((s): s is string => !!s) ?? null;

  return await linkClientResponseToProperty({
    db,
    accountId,
    userId,
    contact,
    contactName: contact.name || 'Client',
    property,
    label: propertyLabel(property),
    summary,
    accessToken: args.accessToken,
    phoneNumberId: args.phoneNumberId,
  });
}

export async function completeClientResponsePropertyId(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  propertyId: string;
  accessToken: string;
  phoneNumberId: string;
}): Promise<ClientReplyOutcome | null> {
  const [{ data: contactRow }, { data: propertyRow }] = await Promise.all([
    args.db
      .from('contacts')
      .select('id, name, phone')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    args.db
      .from('properties')
      .select(
        'id, title, property_code, owner_contact_id, listing_source, location, sublocality, city, type, tags'
      )
      .eq('id', args.propertyId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
  ]);
  if (!contactRow || !propertyRow) return null;
  const contact = contactRow as BookContact;
  const property = propertyRow as PropertyRow;
  const { data: notes } = await args.db
    .from('contact_notes')
    .select('note_text')
    .eq('contact_id', args.contactId)
    .order('created_at', { ascending: false })
    .limit(5);
  const summary =
    (notes ?? [])
      .map((note) => extractLoggedSummary(note.note_text as string))
      .find((value): value is string => Boolean(value)) ?? null;

  return await linkClientResponseToProperty({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    contact,
    contactName: contact.name || 'Client',
    property,
    label: propertyLabel(property),
    summary,
    relatedOwnerName: parsePropertyOwnerName(summary),
    accessToken: args.accessToken,
    phoneNumberId: args.phoneNumberId,
  });
}

export interface HandleClientFollowupArgs {
  db: SupabaseClient;
  accountId: string;
  /** The WhatsApp config owner — to-do owner + notification recipient. */
  ownerUserId: string;
  contact: { id: string; name?: string | null; phone: string };
  conversationId: string;
  replyId: string;
}

/**
 * The client's tap on a `jfu_` timeline button: stamps the journey
 * item's planned step, files a follow-up to-do, acks the client and
 * notifies the agent. Returns false when the id isn't ours.
 */
export async function handleClientFollowupReply(
  args: HandleClientFollowupArgs
): Promise<boolean> {
  const parsedId = parseClientFollowupReplyId(args.replyId);
  if (!parsedId) return false;
  return await applyTimelineChoice({
    ...args,
    choice: parsedId.choice,
    itemId: parsedId.itemId,
    byAgent: false,
  });
}

/**
 * The client's tap on the `enquiry_timeline_notice` template. Template
 * quick replies arrive as button TEXT with no id, so the journey item
 * cannot be encoded in the button — it is resolved from the contact's
 * own most recent client_response event, which is what the ask always
 * follows. Returns false when the tap was some other template's.
 */
export async function handleTimelineTemplateTap(
  args: Omit<HandleClientFollowupArgs, 'replyId'> & { buttonText: string }
): Promise<boolean> {
  const choice = timelineChoiceForAction(matchTemplateButton(args.buttonText));
  if (!choice) return false;

  const itemId = await latestRespondedItemId(
    args.db,
    args.accountId,
    args.contact.id
  );
  if (!itemId) {
    await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.ownerUserId,
      contactId: args.contact.id,
      conversationId: args.conversationId,
      kind: 'text',
      senderType: 'bot',
      text: CLIENT_FOLLOWUP_ACKS[choice],
    });
    return true;
  }
  return await applyTimelineChoice({ ...args, choice, itemId, byAgent: false });
}

/**
 * The agent's tap on a `jfa_` button in their own bot chat — the
 * fallback when the client could not be reached. Same effect on the
 * journey; only the acknowledgement differs, because the person
 * tapping is staff rather than the lead.
 */
export async function handleAgentFollowupReply(
  args: HandleClientFollowupArgs & {
    /** The lead the reminder is about — NOT the tapping agent. */
    replyId: string;
  }
): Promise<boolean> {
  const parsedId = parseAgentFollowupReplyId(args.replyId);
  if (!parsedId) return false;
  return await applyTimelineChoice({
    ...args,
    choice: parsedId.choice,
    itemId: parsedId.itemId,
    byAgent: true,
  });
}

/** The journey item a bare timeline tap refers to: the one whose client
 *  response was logged most recently for this contact. The ask is only
 *  ever sent immediately after logging a response, so the newest such
 *  event is the subject. */
async function latestRespondedItemId(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  const { data: items } = await db
    .from('journey_items')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active');
  const ids = ((items ?? []) as Array<{ id: string }>).map((i) => i.id);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  const { data: events } = await db
    .from('journey_events')
    .select('item_id, created_at')
    .eq('account_id', accountId)
    .eq('event_type', 'client_response')
    .in('item_id', ids)
    .order('created_at', { ascending: false })
    .limit(1);
  return (
    ((events ?? [])[0] as { item_id: string } | undefined)?.item_id ?? null
  );
}

async function applyTimelineChoice(
  args: Omit<HandleClientFollowupArgs, 'replyId'> & {
    choice: ClientFollowupChoice;
    itemId: string;
    byAgent: boolean;
  }
): Promise<boolean> {
  const {
    db,
    accountId,
    ownerUserId,
    contact,
    conversationId,
    choice,
    itemId,
    byAgent,
  } = args;

  const ackClient = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      userId: ownerUserId,
      contactId: contact.id,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
    });

  const { data: itemData } = await db
    .from('journey_items')
    .select('id, contact_id, property_id, stage_id, status')
    .eq('id', itemId)
    .eq('account_id', accountId)
    .maybeSingle();
  const item = itemData as {
    id: string;
    contact_id: string;
    property_id: string;
    stage_id: string;
    status: string;
  } | null;
  // A client may only answer about their own branch; an agent is acting
  // on someone else's by design, so the ownership check is theirs alone.
  if (!item || (!byAgent && item.contact_id !== contact.id)) {
    await ackClient('👍 Noted, thank you!');
    return true;
  }

  const { data: property } = await db
    .from('properties')
    .select('id, title, property_code')
    .eq('id', item.property_id)
    .maybeSingle();
  const label = property
    ? propertyLabel(property as PropertyRow)
    : 'the property';
  const choiceLabel = templateButtonLabel(
    timelineButtonAction(choice),
    DEFAULT_LANGUAGE
  );
  const due = followupDueDate(choice);

  // They have just said when to come back. Unprompted new-listing
  // pitches hold until then; alerts they opted into, and every reply to
  // something they send, are untouched.
  const { error: quietError } = await db
    .from('contacts')
    .update({ pitch_quiet_until: quietUntilFrom(due).toISOString() })
    .eq('id', item?.contact_id ?? contact.id)
    .eq('account_id', accountId);
  if (quietError)
    console.error('[client-response] quiet window failed:', quietError.message);

  const { error: evError } = await db.from('journey_events').insert({
    account_id: accountId,
    item_id: item.id,
    event_type: 'client_response',
    reason: byAgent
      ? `Agent set the next check-back to "${choiceLabel}"`
      : `Client chose "${choiceLabel}" for their next update`,
  });
  if (evError)
    console.error('[client-response] choice event failed:', evError.message);

  const itemUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (due) {
    itemUpdate.planned_at = format(due, 'yyyy-MM-dd');
    const { data: stageRows } = await db
      .from('journey_stages')
      .select('id, name, position')
      .eq('account_id', accountId)
      .order('position');
    const stages = (stageRows ?? []) as StageRow[];
    const idx = stages.findIndex((s) => s.id === item.stage_id);
    const next = idx >= 0 ? stages[idx + 1] : undefined;
    if (next) itemUpdate.planned_stage_id = next.id;
  }
  await db.from('journey_items').update(itemUpdate).eq('id', item.id);

  // The to-do belongs to the lead's branch, so it is filed against the
  // journey item's contact rather than whoever tapped.
  const { data: subject } = await db
    .from('contacts')
    .select('name')
    .eq('id', item.contact_id)
    .maybeSingle();
  const subjectName =
    (subject as { name?: string | null } | null)?.name ||
    (byAgent ? 'the client' : contact.name) ||
    'client';

  if (due) {
    const { data: existingTodo } = await db
      .from('todos')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', item.contact_id)
      .eq('property_id', item.property_id)
      .eq('completed', false)
      .eq('source', 'system')
      .limit(1)
      .maybeSingle();
    const todo = {
      account_id: accountId,
      user_id: ownerUserId,
      assigned_to: ownerUserId,
      title: `Follow up with ${subjectName} — ${label}`,
      due_date: due.toISOString(),
      priority: 'medium',
      completed: false,
      contact_id: item.contact_id,
      property_id: item.property_id,
      source: 'system',
    };
    const { error: todoError } = existingTodo
      ? await db.from('todos').update(todo).eq('id', existingTodo.id)
      : await db.from('todos').insert(todo);
    if (todoError)
      console.error(
        '[client-response] follow-up todo failed:',
        todoError.message
      );
  }

  if (byAgent) {
    // The agent is mid-conversation with the bot; the chatbot path
    // persists its own reply, so only the confirmation goes back.
    await ackClient(
      due
        ? `📅 Reminder set for *${format(due, 'd MMM')}* — follow up with ${subjectName} on ${label}.`
        : `👍 No date set. ${subjectName}'s branch stays open on ${label}.`
    );
    return true;
  }

  await ackClient(CLIENT_FOLLOWUP_ACKS[choice]);

  await createNotification({
    accountId,
    userId: ownerUserId,
    type: 'new_message',
    title: `📅 ${subjectName}: "${choiceLabel}" on ${label}`,
    body: due
      ? `Follow-up to-do added for ${format(due, 'd MMM')}.`
      : "They can't commit to a date yet.",
    entityType: 'contact',
    entityId: item.contact_id,
    link: `/journey?contact=${item.contact_id}`,
  });

  return true;
}

/** The fixed opening phrase of every journey check-in (locked by
 *  checkin-message.test.ts) — how an inbound reply is recognized as
 *  answering one, since check-ins are typed from the inbox composer
 *  and leave no send record of their own. */
export const JOURNEY_CHECKIN_PHRASE = 'just checking in on';

export function isJourneyCheckinText(text?: string | null): boolean {
  return (text || '').toLowerCase().includes(JOURNEY_CHECKIN_PHRASE);
}

const CHECKIN_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RESPONSE_REASON_LIMIT = 280;

export type InboxCheckinOutcome = 'not_checkin' | 'logged' | 'logged_and_asked';

export interface InboxCheckinReplyArgs {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  contact: { id: string; name?: string | null; phone: string };
  conversationId: string;
  responseText: string;
  accessToken: string;
  phoneNumberId: string;
  /** true for the check-in template's "Still considering it" tap — the
   *  tap itself is the answer, so the phrase gate is skipped and the
   *  property is scanned from recent outbound messages. */
  fromButton?: boolean;
}

/**
 * A client answering a check-in directly in the Engine inbox: the same
 * capture as the screenshot path, minus the AI — the contact and
 * conversation are already known, the property is scanned out of the
 * check-in message itself, and the client's own words become the
 * journey event. Returns 'not_checkin' when the thread's last outbound
 * wasn't a check-in (callers fall through to normal handling), 'logged'
 * when the reply was recorded but reads as a question the bot should
 * still answer, and 'logged_and_asked' when the timeline buttons went
 * out and the message is fully handled.
 */
export async function handleInboxCheckinReply(
  args: InboxCheckinReplyArgs
): Promise<InboxCheckinOutcome> {
  const {
    db,
    accountId,
    ownerUserId,
    contact,
    conversationId,
    responseText,
    accessToken,
    phoneNumberId,
    fromButton,
  } = args;

  const { data: outboundData } = await db
    .from('messages')
    .select('content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .order('created_at', { ascending: false })
    .limit(fromButton ? 10 : 1);
  const cutoff = Date.now() - CHECKIN_REPLY_WINDOW_MS;
  const checkins = (
    (outboundData ?? []) as Array<{
      content_text: string | null;
      created_at: string;
    }>
  ).filter(
    (m) =>
      new Date(m.created_at).getTime() > cutoff &&
      (fromButton || isJourneyCheckinText(m.content_text))
  );
  if (checkins.length === 0) return 'not_checkin';

  const { data: propData } = await db
    .from('properties')
    .select('id, title, property_code')
    .eq('account_id', accountId);
  const properties = ((propData ?? []) as PropertyRow[]).filter(
    (p): p is PropertyRow & { title: string } => Boolean(p.title)
  );
  const found = scanMessagesForProperties(checkins, properties);
  const propertyId = found.keys().next().value as string | undefined;
  const property = properties.find((p) => p.id === propertyId);
  if (!property) return 'not_checkin';
  const label = propertyLabel(property);

  const stages = await loadStages(db, accountId);
  const item = await ensureJourneyItem(
    db,
    accountId,
    ownerUserId,
    contact.id,
    property.id,
    stages,
    'Captured from check-in reply'
  );
  if (!item) return 'not_checkin';

  const contactName = contact.name || 'Client';
  const response = responseText.trim().slice(0, RESPONSE_REASON_LIMIT);

  const { error: evError } = await db.from('journey_events').insert({
    account_id: accountId,
    item_id: item.id,
    event_type: 'client_response',
    reason: response,
  });
  if (evError)
    console.error('[client-response] inbox event failed:', evError.message);
  await db
    .from('journey_items')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', item.id);

  const { error: noteError } = await db.from('contact_notes').insert({
    contact_id: contact.id,
    account_id: accountId,
    user_id: ownerUserId,
    note_text: `💬 ${contactName} on ${label}: "${response}" (check-in reply)`,
  });
  if (noteError)
    console.error('[client-response] inbox note failed:', noteError.message);

  await appendDealNotes(
    db,
    contact.id,
    property.id,
    `[${format(new Date(), 'd MMM yyyy')}] Client response: ${response}`
  );

  await createNotification({
    accountId,
    userId: ownerUserId,
    type: 'new_message',
    title: `💬 ${contactName} responded on ${label}`,
    body: response,
    entityType: 'contact',
    entityId: contact.id,
    link: `/journey?contact=${contact.id}`,
    channels: { inApp: true, push: true, whatsapp: false },
  });

  if (!fromButton && looksLikeQuestion(response)) return 'logged';

  const askOutcome = await askClientForTimeline({
    db,
    accountId,
    userId: ownerUserId,
    contact: {
      id: contact.id,
      name: contact.name ?? null,
      phone: contact.phone,
    },
    itemId: item.id,
    bodyText: buildClientAskBody({
      contactName,
      propertyLabel: label,
      responseSummary: fromButton ? null : response,
    }),
    contactName,
    propertyLabel: label,
    accessToken,
    phoneNumberId,
  });
  return askOutcome === 'sent' || askOutcome === 'sent_template'
    ? 'logged_and_asked'
    : 'logged';
}
