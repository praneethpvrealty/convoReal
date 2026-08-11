// ============================================================
// WhatsApp scheduling for the owner chatbot — the agent texts or
// voice-notes their own bot ("site visit with Varun tomorrow 4pm
// at the JP Nagar plot") and it lands on the Engine calendar.
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
  parseEventUpdate,
  resolveByName,
  istLocalToUtcIso,
  type ParsedEventDraft,
} from '@/lib/calendar/event-parse';
import { recordBotTarget } from '@/lib/whatsapp/bot-message-target';
import { parseEventOutcome } from '@/lib/calendar/event-outcome';
import { autoLinkContactProperty } from '@/lib/calendar/auto-link';
import { createNotification } from '@/lib/notifications/create';

const EVENT_TYPE_EMOJI: Record<string, string> = {
  site_visit: '📍',
  call: '📞',
  follow_up: '🔁',
  document: '📄',
  meeting: '🤝',
  other: '🗓',
};

/** Phrases that are a scheduling request on their own. */
const SCHEDULING_VERB =
  /\b(remind me|reminder|schedule|re-?schedule|book|fix (a |the )?(meeting|visit|call|appointment)|set up (a )?(meeting|visit|call)|follow ?up (with|on)|site visit)\b/i;

/**
 * An explicit to-do declaration.
 *
 * The colon form is the obvious one ("task: call the lawyer"), but a
 * dictated list does not use it — "Add for today's task 1) …" states
 * the intent just as plainly and used to miss, which cost it the
 * stated-outright pass and left it to be vetoed by the portal back-off
 * below. So a list marker after the noun counts too — and so does
 * the word "list", because "Add to the todo list - ..." puts a noun
 * between the declaration and the jobs.
 */
const TASK_PREFIX = /\b(task|todo|to-do)s?\b(\s*(:|-|\d)|\s+list\b)/i;

/** Something that happens at a time, which needs a WHEN to be a request. */
const EVENT_VERB = /\b(call|meet|meeting|visit|appointment)\b/i;

/**
 * Relative days and clock times: "tomorrow", "next fri", "at 4pm", "18:30".
 * The bare form requires a colon — "3.50" is an acreage or a price far more
 * often than it is half past three.
 */
const TIME_CUE =
  /\b(tomorrow|today|tonight|day after|(this|next|coming) (week|month|mon|tue|wed|thu|fri|sat|sun)[a-z]*|at \d{1,2}([:.]\d{2})?\s?(am|pm)?|\d{1,2}\s?(am|pm)|\d{1,2}:\d{2})\b/i;

/**
 * Calendar dates: "30th July 2026", "Jul 30", "30/07/2026", "on Friday".
 * A named day or a written-out date is how anyone books more than a week
 * out, and the relative-day cues above cannot express it.
 *
 * The numeric form takes a slash, or dashes with a year — a bare "2-3" is
 * a budget range ("2-3 crore"), not the second of March.
 */
const DATE_CUE =
  /\b(\d{1,2}(st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(st|nd|rd|th)?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{1,2}-\d{1,2}-\d{2,4}|(mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

/** Forwarded listings and portal leads — intake material, not events. */
const LISTING_SIGNAL =
  /\b(bhk|sqft|sq ?ft|crore|lakh|per sqft|facing|carpet|super built|listing|for sale|for rent)\b/gi;
const LEAD_FORWARD = /\b(is interested in|referred by|magicbricks|99acres|housing\.com)\b/i;

/** Cheap deterministic gate so we never burn AI credits on forwarded
 *  listings / lead texts. Requires a scheduling verb or an event verb
 *  with a WHEN, and backs off when the text smells like intake material.
 *  Passing only buys an AI parse — `intent: 'none'` still falls through
 *  to the intake flows, so this errs toward letting a request in. */
export function looksLikeSchedulingText(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;

  // Verb and WHEN are tested independently rather than as one ordered
  // pattern: "on Monday, meet the lawyer" is the same request as "meet
  // the lawyer on Monday", and a WhatsApp message often wraps the two
  // onto separate lines.
  const explicit = SCHEDULING_VERB.test(t) || TASK_PREFIX.test(t);
  const verbWithWhen = EVENT_VERB.test(t) && (TIME_CUE.test(t) || DATE_CUE.test(t));
  if (!explicit && !verbWithWhen) return false;

  // "Remind me" / "schedule" / "task:" is the user saying it outright, so
  // it survives the back-offs below.
  const statedOutright = /\b(remind me|schedule)\b/i.test(t) || TASK_PREFIX.test(t);
  if (statedOutright) return true;

  // A long listing-style forward wins even if it mentions "visit".
  const listingSignals = (t.match(LISTING_SIGNAL) || []).length;
  if (listingSignals >= 2) return false;

  // So does a forwarded lead that happens to say "call him on Monday" —
  // it has to reach contact ingestion, which is what these same phrases
  // gate there (chatbot-engine's hasContactKeywords).
  if (LEAD_FORWARD.test(t)) return false;

  return true;
}

export function isAgendaCommand(text: string): boolean {
  return /^(today|agenda|my day|schedule\??|today'?s schedule)$/i.test(text.trim());
}

/**
 * A dictated to-do list, split into its items.
 *
 * "Add for today's task 1) … 2) … 3) …" is one message carrying three
 * separate jobs, and everything downstream resolves exactly one draft —
 * so without this the second and third items are swallowed into the
 * first one's title.
 *
 * Deterministic and free. The numbering is the author's own structure;
 * paying for an AI call to rediscover it would be paying to be told
 * what the text already says.
 *
 * Only a run that actually counts 1, 2, 3 splits. That is what keeps
 * "12 acres" and a lone "2)" out of it, and it is why the marker has to
 * be followed by a separator and a space — a bare number is a quantity
 * far more often than it is a heading.
 *
 * Numbers win, and while a numbered run exists the lettered markers
 * inside it are left alone: "3) Followup with X regarding a) … b) …"
 * is one job with two things to raise, not three jobs.
 *
 * Letters only split when there is NO numbered run at all — "Add to
 * the todo list - Work on Dinakar site a) Cleaning up the site b) E
 * khata", which is two jobs and was reaching the classifier as
 * "I couldn't tell what that was". The words before the first letter
 * are carried onto each item, because "Cleaning up the site" on its
 * own does not say which site.
 *
 * Returns [] when there is no list, which leaves the single-draft path
 * exactly as it was.
 */
export function splitTaskList(text: string): string[] {
  const t = (text || '').trim();
  if (!t) return [];

  const numbered = markerRun(t, /(?:^|[\s.,;])(\d{1,2})\s*[).:]\s+/g, (raw, i) =>
    Number(raw) === i + 1
  );
  if (numbered.length >= 2) return sliceItems(t, numbered);

  // A letter needs no space after its bracket ("b)E khata"), because
  // unlike a digit it is never part of the value that follows.
  const lettered = markerRun(t, /(?:^|[\s.,;(])([a-z])\s*[).:]\s*/gi, (raw, i) =>
    raw.toLowerCase().charCodeAt(0) === 97 + i
  );
  if (lettered.length < 2) return [];

  // "Add to the todo list - Work on Dinakar site" → "Work on Dinakar
  // site". The declaration is scaffolding; what follows it is the
  // subject the lettered parts belong to.
  const lead = t
    .slice(0, lettered[0].at)
    .replace(/^.*?\b(task|todo|to-do)s?\b(\s+list\b)?\s*[-:–—]?\s*/i, '')
    .trim()
    .replace(/[-–—:,.\s]+$/, '')
    .trim();

  return sliceItems(t, lettered).map((item) => (lead ? `${lead} — ${item}` : item));
}

/** Positions of a marker sequence that actually counts from its start. */
function markerRun(
  t: string,
  pattern: RegExp,
  inSequence: (raw: string, index: number) => boolean
): { at: number; from: number }[] {
  const hits: { at: number; from: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(t)) !== null) {
    if (!inSequence(m[1], hits.length)) continue;
    hits.push({ at: m.index, from: m.index + m[0].length });
  }
  return hits;
}

function sliceItems(t: string, hits: { at: number; from: number }[]): string[] {
  return hits
    .map((h, i) => t.slice(h.from, i + 1 < hits.length ? hits[i + 1].at : undefined))
    .map((s) => s.trim().replace(/[.,;\s]+$/, '').trim())
    .filter(Boolean);
}

/**
 * Text that is unmistakably a dictated to-do list: it says so, and it
 * carries a numbered run to prove it.
 *
 * Strong enough to interrupt an intake draft. The ordinary scheduling
 * pre-filter is not — "site visit" inside a correction to a listing is
 * describing the listing — which is why the intercept normally stands
 * down while a draft is mid-flight. A message that declares itself a
 * task list and then numbers the tasks is not a correction to anything.
 *
 * Without this the first misroute was self-perpetuating: a listing
 * draft opened by a task list swallowed the next task list as an edit,
 * refreshing its own timeout each time, so it never expired and the
 * calendar never saw another one.
 */
export function isDictatedTaskList(text?: string | null): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return TASK_PREFIX.test(t) && splitTaskList(t).length >= 2;
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
  /** Null for "do it whenever" — a voice note that named no day. Those
   *  tasks still belong on the agenda, under their own heading, or the
   *  card's "Reply *today* to see your day's schedule" is a lie. */
  due_date?: string | null;
}

/** Undated tasks shown before the list is truncated — enough to be
 *  useful, not so many that a long backlog buries the actual day. */
const MAX_UNDATED_TODOS = 5;

export function formatAgendaMessage(dateLabel: string, events: AgendaEvent[], todos: AgendaTodo[]): string {
  const lines: string[] = [`🗓 *Your schedule — ${dateLabel}*`];

  const active = events.filter((e) => e.status === 'scheduled');
  const dated = todos.filter((t) => t.due_date != null);
  const undated = todos.filter((t) => t.due_date == null);

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

  if (dated.length > 0) {
    lines.push('', '✅ *Tasks due:*');
    for (const t of dated) {
      lines.push(`${t.priority === 'high' ? '🔴' : '•'} ${t.title}`);
    }
  }

  if (undated.length > 0) {
    lines.push('', '📌 *No date set:*');
    for (const t of undated.slice(0, MAX_UNDATED_TODOS)) {
      lines.push(`${t.priority === 'high' ? '🔴' : '•'} ${t.title}`);
    }
    const hidden = undated.length - MAX_UNDATED_TODOS;
    if (hidden > 0) lines.push(`_+${hidden} more on the Calendar page._`);
  }

  return lines.join('\n');
}

/** Confirmation sent back to a lead whose inbound message we turned
 *  into an appointment. Deliberately non-committal — the event lands on
 *  the agent's calendar and the agent confirms — and phrased for the
 *  contact, not the Engine owner. */
export function formatInboundConfirmation(params: {
  contactName: string | null;
  title: string;
  eventType: string;
  startIso: string;
  propertyTitle: string | null;
  location: string | null;
}): string {
  const when = new Date(params.startIso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const emoji = EVENT_TYPE_EMOJI[params.eventType] || '🗓';
  return [
    `Hi ${params.contactName || 'there'},`,
    '',
    "🗓 *I've noted your request:*",
    `${emoji} ${params.title}`,
    `🕐 ${when}`,
    params.propertyTitle ? `🏡 ${params.propertyTitle}` : null,
    params.location ? `📌 ${params.location}` : null,
    '',
    'Our team will confirm shortly. Reply here if you need a different time.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
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
}): Promise<string | null> {
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
      awaiting_reply: false,
    })
    .eq('id', params.conversationId);
  return sendRes.messageId || null;
}

export interface SchedulingEditParams {
  target: { entityType: 'appointment' | 'todo'; entityId: string };
  instruction: string;
  contactRecord: { id: string; phone: string };
  conversation: { id: string };
  accountId: string;
  userId: string;
  accessToken: string;
  phoneNumberId: string;
  now?: Date;
}

/** An appointment can still be corrected until it is over and while it
 *  is still on the books — a finished or cancelled event is history, so
 *  a correction becomes a new booking rather than a silent rewrite. */
function isEditableAppointment(row: { status: string; end_time: string | null; start_time: string }, now: Date): boolean {
  if (row.status !== 'scheduled') return false;
  const ends = new Date(row.end_time || row.start_time).getTime();
  return Number.isFinite(ends) && ends > now.getTime();
}

/**
 * A quote-reply on a confirmation card ("change this to Monday 5pm").
 * Edits the row that card announced. Returns 'edited' when the row was
 * updated, 'stale' when it is gone or no longer editable — the caller
 * then falls through to the normal create path, so the correction still
 * lands as a fresh event and the user is told which happened.
 */
export async function applySchedulingEdit(
  params: SchedulingEditParams
): Promise<'edited' | 'stale' | 'skipped'> {
  const { target, instruction, contactRecord, conversation, accountId, accessToken, phoneNumberId } = params;
  const now = params.now || new Date();
  const admin = supabaseAdmin();
  const table = target.entityType === 'appointment' ? 'appointments' : 'todos';

  const { data: row, error } = await admin
    .from(table)
    .select('*')
    .eq('id', target.entityId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[wa-scheduler] edit target fetch failed:', error);
    return 'skipped';
  }
  if (!row) return 'stale';

  // ── "This is already done." ──────────────────────────────────
  // Closing the event out, ahead of the reschedule parse and ahead of
  // the editability window: an outcome is reported AFTER the thing
  // happened, and isEditableAppointment deliberately refuses anything
  // past its end time. Applying the same rule here would reject every
  // report that arrived at the only moment it could be true.
  //
  // Free — no model call, and the agent's own sentence is the outcome.
  if (target.entityType === 'appointment' && row.status === 'scheduled') {
    const reported = parseEventOutcome(instruction);
    if (reported) {
      const { error: outcomeErr } = await admin
        .from('appointments')
        .update({
          status: reported.status,
          // Kept for a completion only. A cancelled visit has no
          // outcome — nothing happened to report on — and writing the
          // cancellation sentence into the feedback field would put it
          // in front of an agent later as if it were one.
          ...(reported.status === 'completed' ? { outcome: reported.outcome } : {}),
        })
        .eq('id', target.entityId)
        .eq('account_id', accountId);
      if (outcomeErr) {
        console.error('[wa-scheduler] outcome update failed:', outcomeErr);
        return 'skipped';
      }

      const closedWamid = await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: [
          reported.status === 'completed'
            ? '✅ *Marked done on your calendar*'
            : '🚫 *Cancelled on your calendar*',
          `🗓 ${row.title as string}`,
          reported.status === 'completed' ? `📝 ${reported.outcome}` : null,
          '',
          '_Reply to this message to correct it._',
        ]
          .filter((l): l is string => l !== null)
          .join('\n'),
      });
      await recordBotTarget({
        accountId,
        waMessageId: closedWamid,
        entityType: 'appointment',
        entityId: target.entityId,
        client: admin,
      });
      return 'edited';
    }
  }

  if (target.entityType === 'appointment') {
    if (!isEditableAppointment(row as { status: string; end_time: string | null; start_time: string }, now)) {
      return 'stale';
    }
  } else if (row.completed) {
    return 'stale';
  }

  if (!(await hardBurn(accountId, 'event_parse'))) {
    await replyAndLog({
      phoneNumberId,
      accessToken,
      toPhone: contactRecord.phone,
      conversationId: conversation.id,
      text: "🔒 *Out of AI credits — that correction wasn't applied.* Buy more credits or upgrade your plan from the dashboard.",
    });
    return 'skipped';
  }

  const { data: members } = await admin
    .from('profiles')
    .select('user_id, full_name')
    .eq('account_id', accountId);

  let draft: ParsedEventDraft;
  try {
    draft = await parseEventUpdate({
      current: {
        title: row.title as string,
        event_type: (row.event_type as string) ?? null,
        start_time: (row.start_time as string) ?? (row.due_date as string) ?? null,
        end_time: (row.end_time as string) ?? null,
        location: (row.location as string) ?? null,
        agenda: (row.agenda as string) ?? (row.description as string) ?? null,
      },
      instruction,
      memberNames: (members || []).map((m) => m.full_name).filter(Boolean) as string[],
      now,
    });
  } catch (err) {
    console.error('[wa-scheduler] edit parse failed:', err);
    return 'skipped';
  }

  if (draft.intent === 'none') return 'skipped';

  const startIso = istLocalToUtcIso(draft.start_time);
  let endIso = istLocalToUtcIso(draft.end_time);
  if (startIso && !endIso) {
    endIso = new Date(new Date(startIso).getTime() + (draft.duration_minutes || 60) * 60 * 1000).toISOString();
  }

  const patch: Record<string, unknown> =
    target.entityType === 'appointment'
      ? {
          title: draft.title,
          event_type: draft.event_type,
          location: draft.location,
          ...(startIso
            ? {
                start_time: startIso,
                end_time: endIso || startIso,
                // A moved event has to re-arm its reminders, exactly as
                // the dashboard PUT route does when the time changes.
                reminder_morning_sent: false,
                reminder_1h_sent: false,
                agent_reminder_sent: false,
                reschedule_requested_at: null,
                client_confirmed_at: null,
              }
            : {}),
        }
      : {
          title: draft.title,
          priority: draft.priority,
          ...(startIso ? { due_date: startIso } : {}),
        };

  const { error: updErr } = await admin
    .from(table)
    .update(patch)
    .eq('id', target.entityId)
    .eq('account_id', accountId);
  if (updErr) {
    console.error('[wa-scheduler] edit update failed:', updErr);
    return 'skipped';
  }

  const emoji = EVENT_TYPE_EMOJI[draft.event_type] || '🗓';
  const when = startIso
    ? new Date(startIso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : null;

  const confirmationWamid = await replyAndLog({
    phoneNumberId,
    accessToken,
    toPhone: contactRecord.phone,
    conversationId: conversation.id,
    text: [
      target.entityType === 'appointment' ? '✏️ *Updated on your calendar*' : '✏️ *Task updated*',
      `${target.entityType === 'appointment' ? emoji : '📝'} ${draft.title}`,
      when ? `🕐 ${when}` : null,
      draft.location ? `📌 ${draft.location}` : null,
      '',
      '_Reply to this message again to make another change._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  });
  // The new card becomes the editable one, so corrections can chain.
  await recordBotTarget({
    accountId,
    waMessageId: confirmationWamid,
    entityType: target.entityType,
    entityId: target.entityId,
    client: admin,
  });
  return 'edited';
}

export interface OwnerSchedulingParams {
  message: {
    id: string;
    type: string;
    audio?: { id: string; mime_type: string };
  };
  /** Set only by the classifier route in chatbot-engine, which has
   *  already decided this image is a scheduling request and downloaded
   *  the bytes. Its presence is what lets an image past the text
   *  pre-filter below. */
  image?: { buffer: Buffer; mimeType: string };
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
  const { message, image, contentText, contactRecord, conversation, accountId, userId, accessToken, phoneNumberId } = params;
  const admin = supabaseAdmin();
  const text = contentText?.trim() || '';
  const isAudio = message.type === 'audio' && !!message.audio?.id;
  const isImage = !!image;

  // Free deterministic agenda command — no AI, no credits.
  if (!isAudio && text && isAgendaCommand(text)) {
    const { startIso, endIso, label } = istDayWindow();
    const assignmentFilterId = String(userId).replace(/[\\"]/g, '\\$&');
    const [{ data: events }, { data: todos }] = await Promise.all([
      admin
        .from('appointments')
        .select('title, event_type, start_time, location, status, contact:contacts(name)')
        .eq('account_id', accountId)
        .or(`assigned_to.eq."${assignmentFilterId}",and(assigned_to.is.null,user_id.eq."${assignmentFilterId}")`)
        .gte('start_time', startIso)
        .lt('start_time', endIso)
        .order('start_time', { ascending: true }),
      // due_date IS NULL is included on purpose: a task dictated without
      // a day never compares true against a range, so it was invisible
      // to this reply on every day, not just today. That widens the set
      // enough that the same assignment scoping as appointments above is
      // now required — otherwise "today" would list the whole account's
      // undated backlog rather than this agent's.
      admin
        .from('todos')
        .select('title, priority, due_date')
        .eq('account_id', accountId)
        .eq('completed', false)
        .or(`assigned_to.eq."${assignmentFilterId}",and(assigned_to.is.null,user_id.eq."${assignmentFilterId}")`)
        .or(`due_date.is.null,and(due_date.gte.${startIso},due_date.lt.${endIso})`)
        .order('due_date', { ascending: true, nullsFirst: false }),
    ]);
    const reply = formatAgendaMessage(
      label,
      ((events || []) as unknown as AgendaEvent[]),
      (todos || []) as AgendaTodo[]
    );
    await replyAndLog({ phoneNumberId, accessToken, toPhone: contactRecord.phone, conversationId: conversation.id, text: reply });
    return true;
  }

  // A dictated to-do list, filed item by item. Free and deterministic,
  // like the agenda command above: the author numbered the jobs, so the
  // only question left is when they are due.
  //
  // Gated on the text SAYING it is a task list, not merely on carrying
  // numbers — a forwarded listing with numbered floors is not an agenda.
  const listItems =
    !isAudio && !isImage && text && TASK_PREFIX.test(text)
      ? splitTaskList(text)
      : [];
  if (listItems.length >= 2) {
    // "today" is the only due date a list like this states, and it is
    // stated in the preamble rather than per item. Anything else is
    // left undated, which the agenda reply already surfaces.
    const dueIso = /\btoday\b/i.test(text) ? istDayWindow().endIso : null;
    const { data: createdTodos, error } = await admin
      .from('todos')
      .insert(
        listItems.map((title) => ({
          account_id: accountId,
          user_id: userId,
          assigned_to: userId,
          title: title.slice(0, 300),
          due_date: dueIso,
          priority: 'medium',
          completed: false,
          source: 'whatsapp',
        }))
      )
      .select('id');
    if (error) {
      console.error('[wa-scheduler] task list insert failed:', error);
      await replyAndLog({
        phoneNumberId,
        accessToken,
        toPhone: contactRecord.phone,
        conversationId: conversation.id,
        text: '⚠️ Something went wrong saving those tasks. Please try again or add them from the Calendar page.',
      });
      return true;
    }
    const reply = [
      `✅ *${createdTodos?.length ?? listItems.length} tasks added to your list*`,
      dueIso ? '🕐 Due today' : null,
      '',
      ...listItems.map((title, i) => `${i + 1}. ${title}`),
      '',
      '_Reply *today* anytime to see your day\'s schedule._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
    await replyAndLog({
      phoneNumberId,
      accessToken,
      toPhone: contactRecord.phone,
      conversationId: conversation.id,
      text: reply,
    });
    return true;
  }

  // An image arrives here twice: first on this pre-classification pass
  // with no buffer, then again from the classifier route with one. Bail
  // on the first pass — the caption alone ("schedule this") would burn a
  // parse on text that isn't where the request actually is.
  if (!isImage && message.type === 'image') {
    return false;
  }

  if (!isAudio && !isImage && (!text || !looksLikeSchedulingText(text))) {
    return false;
  }

  const feature: AiFeatureKey = isAudio
    ? 'voice_event_parse'
    : isImage
      ? 'image_event_parse'
      : 'event_parse';
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
    } else if (isImage) {
      draft = await parseEventFromInput({
        image: { base64: image!.buffer.toString('base64'), mimeType: image!.mimeType },
        text: text || undefined,
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

  // Resolve references against tenant data. Liaisons are fetched only
  // when the model flagged a professional role — a meeting with a buyer
  // never needs the directory.
  const [{ data: contacts }, { data: properties }, { data: liaisons }] = await Promise.all([
    admin.from('contacts').select('id, name, phone, last_inquired_property_id').eq('account_id', accountId),
    admin.from('properties').select('id, title, property_code, location, sublocality').eq('account_id', accountId),
    draft.service_provider_role
      ? admin.from('liaisons').select('id, name, phone').eq('account_id', accountId).eq('is_active', true)
      : Promise.resolve({ data: [] as { id: string; name: string; phone: string | null }[] }),
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

  // Both parties to the conversation are attendees. The person being met is
  // often an outside professional with no Engine record, while the person who
  // arranged it usually IS a contact — linking only the former left the event
  // attached to nobody, so nobody got a client reminder.
  const counterparty = resolveByName(draft.counterparty_name, contacts || [], (c) => c.name || '');
  const attendees = [contact, counterparty].filter(
    (c, i, all): c is NonNullable<typeof c> => !!c && all.findIndex((o) => o?.id === c.id) === i
  );

  // A lawyer, surveyor or khata agent belongs in the liaisons directory,
  // not in contacts, so a name that fails the contact lookup gets a
  // second chance there before the event is left attached to nobody.
  // Only when contacts came up empty — a person who is genuinely a
  // contact stays one.
  const liaison =
    draft.service_provider_role && !contact
      ? resolveByName(draft.contact_name, liaisons || [], (l) => l.name || '')
      : null;
  // Named a professional we have never recorded: the event still saves,
  // but say so, because silently dropping them is what left the meeting
  // with no record of who it was with.
  const unknownProvider =
    draft.service_provider_role && !contact && !liaison ? draft.contact_name : null;

  const startIso = istLocalToUtcIso(draft.start_time);
  let endIso = istLocalToUtcIso(draft.end_time);
  if (startIso && !endIso) {
    endIso = new Date(new Date(startIso).getTime() + (draft.duration_minutes || 60) * 60 * 1000).toISOString();
  }

  const transcript = draft.transcript || (isAudio ? null : text);
  const assignedTo = assignee?.id || userId;
  const source = isAudio ? 'voice' : 'whatsapp';

  let confirmation: string;
  let created: { type: 'appointment' | 'todo'; id: string } | null = null;
  if (draft.intent === 'schedule' && startIso) {
    const { data: createdAppt, error } = await admin.from('appointments').insert({
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
      contact_id: attendees[0]?.id || null,
      contact_ids: attendees.map((c) => c.id),
      property_id: property?.id || null,
      liaison_id: liaison?.id || null,
      source,
      transcript,
    }).select('id').single();
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
    if (createdAppt?.id) created = { type: 'appointment', id: createdAppt.id as string };

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
      attendees.length > 0 ? `👤 ${attendees.map((c) => c.name).join(', ')}` : null,
      liaison ? `⚖️ ${liaison.name} (${draft.service_provider_role})` : null,
      property ? `🏠 ${property.title}` : null,
      draft.location ? `📌 ${draft.location}` : null,
      assignee && assignee.id !== userId ? `➡️ Assigned to ${assignee.full_name}` : null,
      unknownProvider
        ? `\n💡 ${unknownProvider} (${draft.service_provider_role}) isn't in your contacts or your liaisons directory. Add them under *Liaisons* to keep their number and fees to hand.`
        : null,
      '',
      '_Reply *today* anytime to see your day\'s schedule._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  } else {
    const { data: createdTodo, error } = await admin.from('todos').insert({
      account_id: accountId,
      user_id: userId,
      assigned_to: assignedTo,
      title: draft.title,
      description: draft.notes,
      due_date: startIso,
      priority: draft.priority,
      completed: false,
      contact_id: attendees[0]?.id || null,
      property_id: property?.id || null,
      source,
    }).select('id').single();
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
    if (createdTodo?.id) created = { type: 'todo', id: createdTodo.id as string };
    confirmation = [
      '✅ *Task added to your list*',
      `📝 ${draft.title}`,
      startIso
        ? `🕐 Due ${new Date(startIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}`
        : null,
      attendees[0] ? `👤 ${attendees[0].name}` : null,
      draft.priority === 'high' ? '🔴 High priority' : null,
      '',
      '_Reply *today* anytime to see your day\'s schedule._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  }

  const confirmationWamid = await replyAndLog({
    phoneNumberId,
    accessToken,
    toPhone: contactRecord.phone,
    conversationId: conversation.id,
    text: confirmation,
  });
  // Lets a quote-reply on this card edit the row instead of creating
  // a second one (migration 185).
  if (created) {
    await recordBotTarget({
      accountId,
      waMessageId: confirmationWamid,
      entityType: created.type,
      entityId: created.id,
      client: admin,
    });
  }
  return true;
}

export interface InboundSchedulingParams {
  message: { type: string };
  contentText: string | null;
  contactRecord: { id: string; phone: string; name?: string | null };
  conversation: { id: string };
  accountId: string;
  ownerUserId: string;
  /** The agent this lead's conversation is routed to; the booking is
   *  assigned to them and they get the notification. Falls back to the
   *  account owner when the conversation is unassigned. */
  assignedAgentUserId?: string | null;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * Turns a lead's inbound WhatsApp message ("can we visit the JP Nagar
 * flat this Saturday at 3pm?") into an appointment on the agent's
 * calendar, linked to the sender's contact and owned by the account
 * owner. Text-only and keyword-gated so ordinary chatter and forwarded
 * listings never burn AI credits, and only a concrete date/time creates
 * anything — vague messages fall through to normal handling.
 *
 * Returns true when an appointment was created and the lead acknowledged.
 */
export async function tryHandleInboundScheduling(params: InboundSchedulingParams): Promise<boolean> {
  const { message, contentText, contactRecord, conversation, accountId, ownerUserId, assignedAgentUserId, accessToken, phoneNumberId } = params;
  const text = contentText?.trim() || '';
  const agentUserId = assignedAgentUserId || ownerUserId;

  if (!ownerUserId || message.type !== 'text' || !text || !looksLikeSchedulingText(text)) {
    return false;
  }

  if (!(await hardBurn(accountId, 'event_parse'))) {
    return false;
  }

  let draft: ParsedEventDraft;
  try {
    draft = await parseEventFromInput({ text });
  } catch (err) {
    console.error('[wa-scheduler] inbound parse failed:', err);
    return false;
  }

  const startIso = istLocalToUtcIso(draft.start_time);
  if (draft.intent !== 'schedule' || !startIso) {
    return false;
  }

  let endIso = istLocalToUtcIso(draft.end_time);
  if (!endIso) {
    endIso = new Date(new Date(startIso).getTime() + (draft.duration_minutes || 60) * 60 * 1000).toISOString();
  }

  const admin = supabaseAdmin();
  const { data: properties } = await admin
    .from('properties')
    .select('id, title, property_code, location, sublocality')
    .eq('account_id', accountId);
  const property = resolveByName(
    draft.property_hint,
    properties || [],
    (p) => `${p.property_code || ''} ${p.title || ''} ${p.location || ''} ${p.sublocality || ''}`
  );

  const { data: inserted, error } = await admin
    .from('appointments')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      assigned_to: agentUserId,
      title: draft.title,
      description: draft.notes,
      event_type: draft.event_type,
      start_time: startIso,
      end_time: endIso,
      location: draft.location,
      status: 'scheduled',
      contact_id: contactRecord.id,
      contact_ids: [contactRecord.id],
      property_id: property?.id || null,
      source: 'whatsapp',
      transcript: text,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[wa-scheduler] inbound appointment insert failed:', error);
    return false;
  }

  const whenLabel = new Date(startIso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const leadName = contactRecord.name || contactRecord.phone;
  await createNotification({
    accountId,
    userId: agentUserId,
    type: 'appointment_booked',
    eventKey: 'appointment_booked',
    title: `New booking from ${leadName}`,
    body: [
      `${draft.title}`,
      `🕐 ${whenLabel}`,
      property ? `🏠 ${property.title}` : null,
      draft.location ? `📌 ${draft.location}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
    entityType: 'appointment',
    entityId: inserted.id as string,
    link: '/calendar',
    whatsappText: [
      '📅 *New booking from a lead*',
      `👤 ${leadName}`,
      `${EVENT_TYPE_EMOJI[draft.event_type] || '🗓'} ${draft.title}`,
      `🕐 ${whenLabel}`,
      property ? `🏠 ${property.title}` : null,
      draft.location ? `📌 ${draft.location}` : null,
      '',
      '_Confirm or adjust it on your Calendar._',
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  });

  await replyAndLog({
    phoneNumberId,
    accessToken,
    toPhone: contactRecord.phone,
    conversationId: conversation.id,
    text: formatInboundConfirmation({
      contactName: contactRecord.name ?? null,
      title: draft.title,
      eventType: draft.event_type,
      startIso,
      propertyTitle: property?.title || null,
      location: draft.location,
    }),
  });
  return true;
}
