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
  matchContactByName,
  type BookContact,
} from '@/lib/contacts/draft-match';
import { createNotification } from '@/lib/notifications/create';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { sendInteractiveButtons } from '@/lib/whatsapp/meta-api';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { resolveConversation } from '@/lib/conversations/resolve';

export const CLIENT_FOLLOWUP_PREFIX = 'jfu_';

export type ClientFollowupChoice = 'today' | '2d' | 'unsure';

export const CLIENT_FOLLOWUP_CHOICE_LABELS: Record<
  ClientFollowupChoice,
  string
> = {
  today: 'Today itself',
  '2d': 'In 2 days',
  unsure: "Can't say yet",
};

const CLIENT_FOLLOWUP_ACKS: Record<ClientFollowupChoice, string> = {
  today: "👍 Great — we'll check back with you later today.",
  '2d': "👍 Noted — we'll check back with you in a couple of days.",
  unsure: "👍 No problem — take your time. We're here whenever you're ready.",
};

export function buildClientFollowupButtons(
  itemId: string
): Array<{ id: string; title: string }> {
  return (['today', '2d', 'unsure'] as const).map((choice) => ({
    id: `${CLIENT_FOLLOWUP_PREFIX}${choice}:${itemId}`,
    title: CLIENT_FOLLOWUP_CHOICE_LABELS[choice],
  }));
}

export function parseClientFollowupReplyId(
  replyId: string
): { choice: ClientFollowupChoice; itemId: string } | null {
  if (!replyId.startsWith(CLIENT_FOLLOWUP_PREFIX)) return null;
  const [choice, itemId] = replyId
    .slice(CLIENT_FOLLOWUP_PREFIX.length)
    .split(':');
  if (!itemId) return null;
  if (choice !== 'today' && choice !== '2d' && choice !== 'unsure') return null;
  return { choice, itemId };
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

export type ClientAskOutcome = 'sent' | 'window_closed' | 'no_phone' | 'failed';

export function buildAgentReply(args: {
  contactName: string;
  propertyLabel: string;
  responseSummary: string | null;
  stageName: string | null;
  dealsUpdated: number;
  askOutcome: ClientAskOutcome;
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
  if (args.askOutcome === 'sent') {
    reply += `\n✉️ Asked ${first} when to expect their update — Today itself / In 2 days / Can't say yet. I'll log their answer and set a follow-up for you.`;
  } else if (args.askOutcome === 'window_closed') {
    reply += `\n⏳ Couldn't ask ${first} on WhatsApp — their 24-hour window is closed. Ask them from your chat and forward the reply.`;
  } else if (args.askOutcome === 'no_phone') {
    reply += `\n⏳ Couldn't message ${first} — no phone number on their contact.`;
  } else {
    reply += `\n⚠️ Couldn't reach ${first} on WhatsApp just now.`;
  }
  return reply;
}

export function buildUnmatchedReply(parsed: ParsedClientReply): string {
  const who = parsed.client_name || 'the client';
  return (
    `🤔 I read the conversation but couldn't match *${who}* to a contact in your book.` +
    (parsed.response_summary ? `\n_"${parsed.response_summary}"_` : '') +
    '\n\nSave them as a contact first (send their contact card), then forward the chat again.'
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
  parsed: ParsedClientReply
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
      (c) => c.phone && phonesMatch(c.phone, digits)
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
      (data ?? []) as BookContact[]
    );
  }
  return null;
}

interface PropertyRow {
  id: string;
  title: string | null;
  property_code: string | null;
}

async function matchClientProperty(
  db: SupabaseClient,
  accountId: string,
  parsed: ParsedClientReply
): Promise<PropertyRow | null> {
  const code = (parsed.property_code || '').trim();
  if (code) {
    const { data } = await db
      .from('properties')
      .select('id, title, property_code')
      .eq('account_id', accountId)
      .ilike('property_code', code)
      .limit(1)
      .maybeSingle();
    if (data) return data as PropertyRow;
  }
  const title = (parsed.property_title || '').trim().replace(/[.\s]+$/, '');
  if (title.length >= 8) {
    const escaped = title.replace(/([%_\\])/g, '\\$1');
    const { data } = await db
      .from('properties')
      .select('id, title, property_code')
      .eq('account_id', accountId)
      .ilike('title', `%${escaped}%`)
      .limit(2);
    if (data && data.length === 1) return data[0] as PropertyRow;
  }
  return null;
}

interface ItemRow {
  id: string;
  stage_id: string;
  status: string;
}

async function ensureJourneyItem(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  propertyId: string,
  stages: StageRow[]
): Promise<ItemRow | null> {
  const read = async () => {
    const { data } = await db
      .from('journey_items')
      .select('id, stage_id, status')
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
    .select('id, stage_id, status');
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
    reason: 'Captured from forwarded chat screenshot',
    created_by: userId,
  });
  if (evError)
    console.error('[client-response] capture event failed:', evError.message);
  return created;
}

async function askClientForTimeline(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: BookContact;
  itemId: string;
  bodyText: string;
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
  if (!isWithinCustomerWindow(lastCustomer?.created_at ?? null))
    return 'window_closed';

  try {
    const sent = await sendInteractiveButtons({
      phoneNumberId,
      accessToken,
      to: contact.phone,
      bodyText,
      buttons: buildClientFollowupButtons(itemId),
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
}

/**
 * Matches a parsed screenshot to the Engine's records, logs the response
 * everywhere it should surface, and asks the client for a timeline.
 * Returns the reply to show the forwarding agent. Never throws — a
 * partial failure degrades to what was actually logged.
 */
export async function processClientReplyScreenshot(
  args: ProcessClientReplyArgs
): Promise<string> {
  const { db, accountId, userId, parsed, accessToken, phoneNumberId } = args;

  const contact = await matchClientContact(db, accountId, parsed);
  if (!contact) return buildUnmatchedReply(parsed);
  const contactName = contact.name || parsed.client_name || 'Client';

  const property = await matchClientProperty(db, accountId, parsed);
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
    user_id: userId,
    note_text: noteText,
  });
  if (noteError)
    console.error('[client-response] contact note failed:', noteError.message);

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
    return (
      `✅ *Logged ${contactName}'s response*` +
      (summary ? `:\n_"${summary}"_` : '.') +
      `\n\n📒 Saved to their contact notes — but I couldn't tell which property this is about, so the journey wasn't updated. Forward a screenshot showing the property name or code (e.g. PROP-1138).`
    );
  }

  const stages = await loadStages(db, accountId);
  const item = await ensureJourneyItem(
    db,
    accountId,
    userId,
    contact.id,
    property.id,
    stages
  );
  let stageName: string | null = null;
  let askOutcome: ClientAskOutcome = 'failed';
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

  return buildAgentReply({
    contactName,
    propertyLabel: label,
    responseSummary: summary,
    stageName,
    dealsUpdated,
    askOutcome,
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
  const { db, accountId, ownerUserId, contact, conversationId, replyId } = args;
  const parsedId = parseClientFollowupReplyId(replyId);
  if (!parsedId) return false;

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
    .eq('id', parsedId.itemId)
    .eq('account_id', accountId)
    .maybeSingle();
  const item = itemData as {
    id: string;
    contact_id: string;
    property_id: string;
    stage_id: string;
    status: string;
  } | null;
  if (!item || item.contact_id !== contact.id) {
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
  const choiceLabel = CLIENT_FOLLOWUP_CHOICE_LABELS[parsedId.choice];
  const due = followupDueDate(parsedId.choice);

  const { error: evError } = await db.from('journey_events').insert({
    account_id: accountId,
    item_id: item.id,
    event_type: 'client_response',
    reason: `Client chose "${choiceLabel}" for their next update`,
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

  if (due) {
    const { error: todoError } = await db.from('todos').insert({
      account_id: accountId,
      user_id: ownerUserId,
      assigned_to: ownerUserId,
      title: `Follow up with ${contact.name || 'client'} — ${label}`,
      due_date: due.toISOString(),
      priority: 'medium',
      completed: false,
      contact_id: contact.id,
      property_id: item.property_id,
      source: 'system',
    });
    if (todoError)
      console.error(
        '[client-response] follow-up todo failed:',
        todoError.message
      );
  }

  await ackClient(CLIENT_FOLLOWUP_ACKS[parsedId.choice]);

  await createNotification({
    accountId,
    userId: ownerUserId,
    type: 'new_message',
    title: `📅 ${contact.name || 'Client'}: "${choiceLabel}" on ${label}`,
    body: due
      ? `Follow-up to-do added for ${format(due, 'd MMM')}.`
      : "They can't commit to a date yet.",
    entityType: 'contact',
    entityId: contact.id,
    link: `/journey?contact=${contact.id}`,
  });

  return true;
}
