// ============================================================
// Calendar event parsing — turns natural language (typed text,
// WhatsApp messages, or voice-note audio) into a structured
// event/task draft, then resolves fuzzy references (contact,
// property, team member) against tenant data.
//
// The Gemini call transcribes + extracts in one pass. Everything
// after the model call is deterministic and unit-testable:
// coerceEventDraft() normalizes whatever JSON the model returned,
// istLocalToUtcIso() handles the fixed IST offset, and the
// resolve* helpers do plain substring scoring — no AI.
// ============================================================

import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';

export type EventTypeKey = 'site_visit' | 'call' | 'follow_up' | 'document' | 'meeting' | 'other';

export interface ParsedEventDraft {
  intent: 'schedule' | 'task' | 'none';
  title: string;
  event_type: EventTypeKey;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  contact_name: string | null;
  property_hint: string | null;
  assignee_name: string | null;
  location: string | null;
  priority: 'low' | 'medium' | 'high';
  notes: string | null;
  transcript: string | null;
  /** The weekday word the source literally used, when it used one. Read
   *  off the message by the model; turned into a date by alignDraftToNamedWeekday. */
  day_of_week: string | null;
}

const EVENT_TYPE_VALUES: EventTypeKey[] = ['site_visit', 'call', 'follow_up', 'document', 'meeting', 'other'];

export function normalizeEventType(val?: string | null): EventTypeKey {
  if (!val) return 'other';
  const cleaned = val.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if ((EVENT_TYPE_VALUES as string[]).includes(cleaned)) return cleaned as EventTypeKey;
  if (/visit|site|show/.test(cleaned)) return 'site_visit';
  if (/call|phone|ring/.test(cleaned)) return 'call';
  if (/follow/.test(cleaned)) return 'follow_up';
  if (/doc|paper|agreement|ec\b|khata|registration/.test(cleaned)) return 'document';
  if (/meet|appointment|discussion/.test(cleaned)) return 'meeting';
  return 'other';
}

/** IST has no DST, so a fixed +05:30 suffix converts the model's
 *  local wall-clock time into a correct UTC instant. */
export function istLocalToUtcIso(local: string | null): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function nowInIst(now: Date = new Date()): string {
  return now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Normalizes arbitrary model JSON into a safe ParsedEventDraft. */
export function coerceEventDraft(raw: unknown): ParsedEventDraft {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : null;

  const intentRaw = str(obj.intent)?.toLowerCase();
  const intent: ParsedEventDraft['intent'] =
    intentRaw === 'schedule' || intentRaw === 'task' ? intentRaw : 'none';

  const priorityRaw = str(obj.priority)?.toLowerCase();
  const priority: ParsedEventDraft['priority'] =
    priorityRaw === 'low' || priorityRaw === 'high' ? priorityRaw : 'medium';

  return {
    intent,
    title: str(obj.title) || 'Untitled',
    event_type: normalizeEventType(str(obj.event_type)),
    start_time: str(obj.start_time),
    end_time: str(obj.end_time),
    duration_minutes: num(obj.duration_minutes),
    contact_name: str(obj.contact_name),
    property_hint: str(obj.property_hint),
    assignee_name: str(obj.assignee_name),
    location: str(obj.location),
    priority,
    notes: str(obj.notes),
    transcript: str(obj.transcript),
    day_of_week: str(obj.day_of_week),
  };
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Weekday word to its index, accepting the usual abbreviations
 *  ("mon", "tues", "thurs"). Null when it isn't a weekday at all. */
export function normalizeWeekday(val?: string | null): number | null {
  if (!val) return null;
  const cleaned = val.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length < 3) return null;
  const exact = WEEKDAYS.indexOf(cleaned);
  if (exact >= 0) return exact;
  const prefixed = WEEKDAYS.findIndex((d) => d.startsWith(cleaned));
  return prefixed >= 0 ? prefixed : null;
}

function localDateParts(local: string): { base: number; rest: string } | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/);
  if (!m) return null;
  return { base: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])), rest: m[4] || '' };
}

function shiftLocalDays(local: string, days: number): string {
  const parts = localDateParts(local);
  if (!parts) return local;
  const d = new Date(parts.base + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${parts.rest}`;
}

/**
 * The model reads "Monday" off a message reliably and works out which
 * date that is unreliably — it booked Tue 4 Aug for a thread that said
 * Monday, with Sat 1 Aug given as today. So the weekday it read is
 * authoritative and its arithmetic is not.
 *
 * Snaps the date onto the nearest day carrying that weekday. The window
 * is +/-3 days, which reaches every weekday exactly once, so a deliberate
 * "Monday after next" keeps the week the model chose instead of being
 * dragged back to the coming one. A snap that lands in the past moves on
 * a week — an appointment behind us is never what was meant.
 */
export function alignDraftToNamedWeekday(
  draft: ParsedEventDraft,
  now: Date = new Date()
): ParsedEventDraft {
  const target = normalizeWeekday(draft.day_of_week);
  if (target === null || !draft.start_time) return draft;

  const parts = localDateParts(draft.start_time);
  if (!parts) return draft;

  let delta = (target - new Date(parts.base).getUTCDay() + 7) % 7;
  if (delta > 3) delta -= 7;

  const utc = istLocalToUtcIso(shiftLocalDays(draft.start_time, delta));
  if (utc && new Date(utc).getTime() < now.getTime()) delta += 7;
  if (delta === 0) return draft;

  return {
    ...draft,
    start_time: shiftLocalDays(draft.start_time, delta),
    end_time: draft.end_time ? shiftLocalDays(draft.end_time, delta) : draft.end_time,
  };
}

function buildSystemPrompt(now: Date, memberNames: string[]): string {
  return (
    'You are the scheduling assistant inside a CRM used by Indian real-estate agents. ' +
    'The user logs calendar events and tasks by typing or speaking (Hindi, Kannada, Telugu, Tamil, or English — often mixed). ' +
    `Current date/time in India (IST): ${nowInIst(now)}.\n\n` +
    'From the given text or audio, extract ONE scheduling request as JSON with exactly these keys:\n' +
    '{\n' +
    '  "intent": "schedule" (has a specific date/time to be on a calendar) | "task" (a to-do, possibly with just a due date) | "none" (not a scheduling request at all),\n' +
    '  "title": short imperative summary WITHOUT the date/time words, e.g. "Site visit with Varun - JP Nagar plot",\n' +
    '  "event_type": one of "site_visit" | "call" | "follow_up" | "document" | "meeting" | "other",\n' +
    '  "start_time": "YYYY-MM-DDTHH:mm" in IST local time, resolving relative phrases like "tomorrow evening" (evening=17:00, morning=10:00, afternoon=14:00, night=20:00), or null,\n' +
    '  "day_of_week": the weekday word the message itself uses ("monday", "fri", "this Saturday" -> "saturday"), or null. Copy the word you actually read — never a weekday you worked out from a calendar date, and null when the message gives a date like "30th July" or a relative day like "tomorrow" instead of naming a weekday,\n' +
    '  "end_time": "YYYY-MM-DDTHH:mm" IST or null,\n' +
    '  "duration_minutes": number or null,\n' +
    '  "contact_name": the client/lead person the event is with, or null,\n' +
    '  "property_hint": any property/project/locality identifying words, e.g. "18k sqft JP Nagar commercial", or null,\n' +
    '  "assignee_name": a TEAM member the speaker assigns this to ("ask Surya to...", "Surya should call..."), or null when the speaker will do it themselves,\n' +
    '  "location": meeting place or address if stated, or null,\n' +
    '  "priority": "low" | "medium" | "high" (urgent words like "pakka", "important", "urgent", "asap" mean high),\n' +
    '  "notes": any remaining useful detail, or null,\n' +
    '  "transcript": when the input is audio, the verbatim transcript translated to English; null for text input\n' +
    '}\n\n' +
    (memberNames.length > 0
      ? `Team member names for assignee matching: ${memberNames.join(', ')}.\n`
      : '') +
    'Rules: never invent a date/time that was not implied. "Remind me to X" with no time is intent "task". ' +
    'A stated calendar date with no time of day ("meet the lawyer on 30th July") IS intent "schedule" — ' +
    'use 10:00 as the hour, the same default as "morning", rather than midnight. ' +
    'A forwarded property listing or a lead\'s contact details is intent "none". ' +
    'Respond with ONLY the JSON object.'
  );
}

/**
 * Screenshots are almost always a forwarded chat thread, which brings
 * failure modes plain text does not: bubble clock times that look like
 * event times, two names where only one is the person being met, and a
 * day-of-week with no date anywhere on screen.
 */
const SCREENSHOT_INSTRUCTION =
  'This image is a screenshot, usually of a chat conversation. Read every message bubble in order and extract the ONE appointment the people in it agree on.\n' +
  'Right-aligned / green bubbles are the person who forwarded you this screenshot; left-aligned / grey bubbles are the other party. The event is between them.\n' +
  'The small clock times printed on each bubble (e.g. "11:49") are when the MESSAGE was sent — never treat them as the appointment time. Use only a day/time stated inside the message wording.\n' +
  'Set contact_name to the person the appointment is WITH. When one name is the person being met and another is merely the person chatting, prefer the one being met.\n' +
  'Put the conversation you read, as plain text, into "transcript".\n' +
  'If the thread never settles on a specific day or time, or is not about arranging a meeting at all, return intent "none" rather than guessing a slot.';

export interface EventParseInput {
  text?: string;
  audio?: { base64: string; mimeType: string };
  image?: { base64: string; mimeType: string };
  memberNames?: string[];
  now?: Date;
}

export async function parseEventFromInput(input: EventParseInput): Promise<ParsedEventDraft> {
  const parts: GeminiPart[] = [];
  if (input.audio) {
    const mimeType = input.audio.mimeType.split(';')[0].trim() || 'audio/ogg';
    parts.push({ inlineData: { mimeType, data: input.audio.base64 } });
    parts.push({ text: 'Extract the scheduling request from this voice note.' });
  }
  if (input.image) {
    const mimeType = input.image.mimeType.split(';')[0].trim() || 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: input.image.base64 } });
    parts.push({ text: SCREENSHOT_INSTRUCTION });
  }
  if (input.text) {
    parts.push({ text: input.text });
  }
  if (parts.length === 0) {
    throw new Error('parseEventFromInput requires text, audio or an image');
  }

  // Typed text is a simple extraction — lite tier. Voice notes need
  // transcription quality and screenshots need to be read and reasoned
  // over, so both stay on the standard tier.
  const raw = await generateJsonFromParts(
    parts,
    buildSystemPrompt(input.now || new Date(), input.memberNames || []),
    input.audio
      ? { feature: 'voice_event_parse' }
      : input.image
        ? { feature: 'image_event_parse' }
        : { tier: 'lite', feature: 'event_parse' }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }
  // Weekday arithmetic is the one part of the extraction the model gets
  // wrong often enough to matter, so it is redone here deterministically
  // for every input path — typed, spoken and screenshotted alike.
  return alignDraftToNamedWeekday(coerceEventDraft(parsed), input.now || new Date());
}

// ── Deterministic reference resolution ──────────────────────────

export interface NamedRef {
  id: string;
  label: string;
}

/** Case-insensitive best match: exact > startsWith > includes >
 *  all-words-included. Returns null rather than guessing badly. */
export function resolveByName<T extends { id: string }>(
  query: string | null,
  rows: T[],
  getLabel: (row: T) => string
): T | null {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  if (!q) return null;

  let best: T | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const label = getLabel(row).toLowerCase();
    if (!label) continue;
    let score = 0;
    if (label === q) score = 4;
    else if (label.startsWith(q) || q.startsWith(label)) score = 3;
    else if (label.includes(q) || q.includes(label)) score = 2;
    else {
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 0 && words.every((w) => label.includes(w))) score = 1;
    }
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}
