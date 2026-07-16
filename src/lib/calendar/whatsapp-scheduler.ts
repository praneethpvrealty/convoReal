// ============================================================
// WhatsApp scheduling for the owner chatbot — the agent texts or
// voice-notes their own bot ("site visit with Varun tomorrow 4pm
// at the JP Nagar plot") and it lands on the CRM calendar.
//
// Runs BEFORE the property/contact intake flows, but only when no
// draft session is active. A strict keyword pre-filter keeps
// forwarded listings and lead details flowing to intake untouched;
// only when the AI confirms intent does anything get created.
// "today" / "agenda" are free deterministic commands that reply
// with the day's schedule — no AI, no credits.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendTextMessage, getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS, type AiFeatureKey } from '@/lib/credits/types';
import {
  parseEventFromInput,
  resolveByName,
  istLocalToUtcIso,
  type ParsedEventDraft,
} from '@/lib/calendar/event-parse';
import { autoLinkContactProperty } from '@/lib/calendar/auto-link';

const EVENT_TYPE_EMOJI: Record<string, string> = {
  site_visit: '📍',
  call: '📞',
  follow_up: '🔁',
  document: '📄',
  meeting: '🤝',
  other: '🗓',
};

/** Cheap deterministic gate so we never burn AI credits on forwarded
 *  listings / lead texts. Requires a scheduling verb or an explicit
 *  time cue, and backs off when the text smells like a listing. */
export function looksLikeSchedulingText(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;

  const schedulingVerb =
    /\b(remind me|reminder|schedule|re-?schedule|book|fix (a |the )?(meeting|visit|call|appointment)|set up (a )?(meeting|visit|call)|follow ?up (with|on)|site visit)\b/i.test(t) ||
    /\b(task|todo|to-do)\s*:/i.test(t) ||
    /\b(call|meet|visit)\b.*\b(tomorrow|today|tonight|day after|next (week|mon|tue|wed|thu|fri|sat|sun)|at \d{1,2}([:.]\d{2})?\s?(am|pm)?|\d{1,2}\s?(am|pm))\b/i.test(t);

  if (!schedulingVerb) return false;

  // A long listing-style forward wins even if it mentions "visit".
  const listingSignals = (t.match(/\b(bhk|sqft|sq ?ft|crore|lakh|per sqft|facing|carpet|super built|listing|for sale|for rent)\b/gi) || []).length;
  if (listingSignals >= 2 && !(/\b(remind me|schedule)\b/i.test(t) || /\b(task|todo|to-do)\s*:/i.test(t))) return false;

  return true;
}

export function isAgendaCommand(text: string): boolean {
  return /^(today|agenda|my day|schedule\??|today'?s schedule)$/i.test(text.trim());
}

interface AgendaEvent {
  title: string;
  event_type: string | null;
  start_time: string;
  location: string | null;
  status: string;
  contact?: { name: string | null } | null;
}

interface AgendaTodo {
  title: string;
  priority: string;
}

export function formatAgendaMessage(dateLabel: string, events: AgendaEvent[], todos: AgendaTodo[]): string {
  const lines: string[] = [`🗓 *Your schedule — ${dateLabel}*`];

  const active = events.filter((e) => e.status === 'scheduled');
  if (active.length === 0 && todos.length === 0) {
    lines.push('', 'Nothing scheduled. Enjoy the breather — or send me a voice note to line something up. 🎙');
    return lines.join('\n');
  }

  if (active.length > 0) {
    lines.push('');
    for (const ev of active) {
      const time = new Date(ev.start_time).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const emoji = EVENT_TYPE_EMOJI[ev.event_type || 'other'] || '🗓';
      const who = ev.contact?.name ? ` · ${ev.contact.name}` : '';
      const where = ev.location ? `\n   📌 ${ev.location}` : '';
      lines.push(`${emoji} *${time}* — ${ev.title}${who}${where}`);
    }
  }

  if (todos.length > 0) {
    lines.push('', '✅ *Tasks due:*');
    for (const t of todos) {
      lines.push(`${t.priority === 'high' ? '🔴' : '•'} ${t.title}`);
    }
  }

  return lines.join('\n');
}

/** Current hour-of-day in IST (0-23). hourCycle 'h23' avoids the
 *  Intl quirk where hour12:false can render midnight as "24". */
export function istHourOf(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now)
  );
}

/** IST midnight-to-midnight window for a given instant. */
export function istDayWindow(now: Date = new Date()): { startIso: string; endIso: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const start = new Date(`${parts}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const label = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  return { startIso: start.toISOString(), endIso: end.toISOString(), label };
}

async function hardBurn(accountId: string, feature: AiFeatureKey): Promise<boolean> {
  try {
    const result = await burnCredits(accountId, feature, AI_FEATURE_COSTS[feature], { hardBlock: true });
    return result.success;
  } catch (err) {
    console.error(`[wa-scheduler] burn failed (fail-open) for '${feature}':`, err);
    return true;
  }
}

async function replyAndLog(params: {
  phoneNumberId: string;
  accessToken: string;
  toPhone: string;
  conversationId: string;
  text: string;
}): Promise<void> {
  const sendRes = await sendTextMessage({
    phoneNumberId: params.phoneNumberId,
    accessToken: params.accessToken,
    to: params.toPhone,
    text: params.text,
  });
  const { error } = await supabaseAdmin().from('messages').insert({
    conversation_id: params.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: params.text,
    message_id: sendRes.messageId || `bot-${Date.now()}`,
    status: 'sent',
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[wa-scheduler] Failed to log bot reply:', error);
  }
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: params.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.conversationId);
}

export interface OwnerSchedulingParams {
  message: {
    id: string;
    type: string;
    audio?: { id: string; mime_type: string };
  };
  contentText: string | null;
  contactRecord: { id: string; phone: string };
  conversation: { id: string };
  accountId: string;
  userId: string;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * Returns true when the message was fully handled as a scheduling
 * interaction (event created, agenda sent, or a scheduling-specific
 * error reply sent). Returns false to let the intake flows proceed.
 */
export async function tryHandleOwnerScheduling(params: OwnerSchedulingParams): Promise<boolean> {
  const { message, contentText, contactRecord, conversation, accountId, userId, accessToken, phoneNumberId } = params;
  const admin = supabaseAdmin();
  const text = contentText?.trim() || '';
  const isAudio = message.type === 'audio' && !!message.audio?.id;

  // Free deterministic agenda command — no AI, no credits.
  if (!isAudio && text && isAgendaCommand(text)) {
    const { startIso, endIso, label } = istDayWindow();
    const [{ data: events }, { data: todos }] = await Promise.all([
      admin
        .from('appointments')
        .select('title, event_type, start_time, location, status, contact:contacts(name)')
        .eq('account_id', accountId)
        .or(`assigned_to.eq.${userId},and(assigned_to.is.null,user_id.eq.${userId})`)
        .gte('start_time', startIso)
        .lt('start_time', endIso)
        .order('start_time', { ascending: true }),
      admin
        .from('todos')
        .select('title, priority')
        .eq('account_id', accountId)
        .eq('completed', false)
        .gte('due_date', startIso)
        .lt('due_date', endIso),
    ]);
    const reply = formatAgendaMessage(
      label,
      ((events || []) as unknown as AgendaEvent[]),
      (todos || []) as AgendaTodo[]
    );
    await replyAndLog({ phoneNumberId, accessToken, toPhone: contactRecord.phone, conversationId: conversation.id, text: reply });
    return true;
  }

  if (!isAudio && (!text || !looksLikeSchedulingText(text))) {
    return false;
  }

  const feature: AiFeatureKey = isAudio ? 'voice_event_parse' : 'event_parse';
  if (!(await hardBurn(accountId, feature))) {
    await replyAndLog({
      phoneNumberId,
      accessToken,
      toPhone: contactRecord.phone,
      conversationId: conversation.id,
      text: "🔒 *Out of AI credits — this message wasn't processed.* Buy more credits or upgrade your plan from the dashboard to unlock AI features.",
    });
    return true;
  }

  const { data: members } = await admin
    .from('profiles')
    .select('user_id, full_name')
    .eq('account_id', accountId);

  let draft: ParsedEventDraft;
  try {
    if (isAudio) {
      const { url, mimeType } = await getMediaUrl({ mediaId: message.audio!.id, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
      draft = await parseEventFromInput({
        audio: { base64: buffer.toString('base64'), mimeType: mimeType || message.audio!.mime_type || 'audio/ogg' },
        memberNames: (members || []).map((m) => m.full_name).filter(Boolean) as string[],
      });
    } else {
      draft = await parseEventFromInput({
        text,
        memberNames: (members || []).map((m) => m.full_name).filter(Boolean) as string[],
      });
    }
  } catch (err) {
    console.error('[wa-scheduler] parse failed:', err);
    if (isAudio) {
      await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: "😕 Couldn't process that voice note. Try again, mentioning what, who, and when — e.g. \"Site visit with Varun tomorrow 4pm at JP Nagar\".",
      });
      return true;
    }
    return false;
  }

  if (draft.intent === 'none') {
    if (isAudio) {
      await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: '🎙 Heard you, but I couldn\'t find an event or task in that. Say something like *"Remind me to call Snigdha tomorrow at 5pm"* and I\'ll put it on your calendar.',
      });
      return true;
    }
    return false;
  }

  // Resolve references against tenant data.
  const [{ data: contacts }, { data: properties }] = await Promise.all([
    admin.from('contacts').select('id, name, phone, last_inquired_property_id').eq('account_id', accountId),
    admin.from('properties').select('id, title, property_code, location, sublocality').eq('account_id', accountId),
  ]);

  const { contact, property } = autoLinkContactProperty(
    resolveByName(draft.contact_name, contacts || [], (c) => c.name || ''),
    resolveByName(
      draft.property_hint,
      properties || [],
      (p) => `${p.property_code || ''} ${p.title || ''} ${p.location || ''} ${p.sublocality || ''}`
    ),
    contacts || [],
    properties || []
  );
  const assignee = resolveByName(
    draft.assignee_name,
    (members || []).map((m) => ({ id: m.user_id as string, full_name: m.full_name as string | null })),
    (m) => m.full_name || ''
  );

  const startIso = istLocalToUtcIso(draft.start_time);
  let endIso = istLocalToUtcIso(draft.end_time);
  if (startIso && !endIso) {
    endIso = new Date(new Date(startIso).getTime() + (draft.duration_minutes || 60) * 60 * 1000).toISOString();
  }

  const transcript = draft.transcript || (isAudio ? null : text);
  const assignedTo = assignee?.id || userId;
  const source = isAudio ? 'voice' : 'whatsapp';

  let confirmation: string;
  if (draft.intent === 'schedule' && startIso) {
    const { error } = await admin.from('appointments').insert({
      account_id: accountId,
      user_id: userId,
      assigned_to: assignedTo,
      title: draft.title,
      description: draft.notes,
      event_type: draft.event_type,
      start_time: startIso,
      end_time: endIso || startIso,
      location: draft.location,
      status: 'scheduled',
      contact_id: contact?.id || null,
      contact_ids: contact ? [contact.id] : [],
      property_id: property?.id || null,
      source,
      transcript,
    });
    if (error) {
      console.error('[wa-scheduler] appointment insert failed:', error);
      await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: '⚠️ Something went wrong saving that event. Please try again or add it from the Calendar page.',
      });
      return true;
    }

    const when = new Date(startIso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const emoji = EVENT_TYPE_EMOJI[draft.event_type] || '🗓';
    confirmation = [
      '✅ *Added to your calendar*',
      `${emoji} ${draft.title}`,
      `🕐 ${when}`,
      contact ? `👤 ${contact.name}` : null,
      property ? `🏠 ${property.title}` : null,
      draft.location ? `📌 ${draft.location}` : null,
      assignee && assignee.id !== userId ? `➡️ Assigned to ${assignee.full_name}` : null,
      '',
      '_Reply *today* anytime to see your day\'s schedule._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  } else {
    const { error } = await admin.from('todos').insert({
      account_id: accountId,
      user_id: userId,
      assigned_to: assignedTo,
      title: draft.title,
      description: draft.notes,
      due_date: startIso,
      priority: draft.priority,
      completed: false,
      contact_id: contact?.id || null,
      property_id: property?.id || null,
      source,
    });
    if (error) {
      console.error('[wa-scheduler] todo insert failed:', error);
      await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: '⚠️ Something went wrong saving that task. Please try again or add it from the Calendar page.',
      });
      return true;
    }
    confirmation = [
      '✅ *Task added to your list*',
      `📝 ${draft.title}`,
      startIso
        ? `🕐 Due ${new Date(startIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}`
        : null,
      contact ? `👤 ${contact.name}` : null,
      draft.priority === 'high' ? '🔴 High priority' : null,
      '',
      '_Reply *today* anytime to see your day\'s schedule._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  }

  await replyAndLog({
    phoneNumberId,
    accessToken,
    toPhone: contactRecord.phone,
    conversationId: conversation.id,
    text: confirmation,
  });
  return true;
}
