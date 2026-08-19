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
import { INPUT_LANGUAGE_HINT } from '@/lib/languages';

export type EventTypeKey = 'site_visit' | 'call' | 'follow_up' | 'document' | 'meeting' | 'other';

export interface ParsedEventDraft {
  /** "notify" is the odd one out: it writes no calendar row at all. It sends what
   *  the speaker said either to a teammate or to a client/contact. Only the
   *  WhatsApp owner path acts on it — see the note on parseEventsFromInput. */
  intent: 'schedule' | 'task' | 'notify' | 'none';
  title: string;
  event_type: EventTypeKey;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  contact_name: string | null;
  /** The other party in the conversation the event came out of — the person
   *  arranging it rather than the person being met. Often the one who is
   *  already an Engine contact, so both get linked and both get reminded. */
  counterparty_name: string | null;
  /** The professional role attached to contact_name when there is one
   *  ("lawyer", "surveyor", "khata agent"). Marks them as someone who
   *  belongs in the liaisons directory rather than in contacts. */
  service_provider_role: string | null;
  property_hint: string | null;
  assignee_name: string | null;
  /** The person to be told, for intent "notify". This can be either a
   *  teammate (an internal update) or a client/contact (a message to be
   *  sent through WhatsApp). It is distinct from assignee_name: assigning
   *  gives someone the work, notifying tells them what happened and
   *  leaves the work where it was. */
  recipient_name: string | null;
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
    intentRaw === 'schedule' || intentRaw === 'task' || intentRaw === 'notify' ? intentRaw : 'none';

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
    counterparty_name: str(obj.counterparty_name),
    service_provider_role: str(obj.service_provider_role),
    property_hint: str(obj.property_hint),
    assignee_name: str(obj.assignee_name),
    recipient_name: str(obj.recipient_name),
    location: str(obj.location),
    priority,
    notes: str(obj.notes),
    transcript: str(obj.transcript),
    day_of_week: str(obj.day_of_week),
  };
}

/** The transcript off whichever shape the model returned — the envelope
 *  of a multi-request answer, or a lone request object. */
function readTranscript(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const val = (raw as Record<string, unknown>).transcript;
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

/**
 * Normalizes the multi-request envelope into drafts worth acting on.
 *
 * Accepts all three shapes the model reaches for — `{ requests: [...] }`,
 * a bare array, and a lone object — because a single-request note is the
 * common case and a model asked for an array still sometimes answers with
 * just the object.
 *
 * `transcript` is read off the envelope rather than the request: it
 * describes the input, not any one thing asked for inside it, and
 * duplicating it per request only invites the model to paraphrase it
 * differently each time.
 *
 * Drops `none` entries, so an empty result means "nothing to act on" and
 * callers need no second check.
 */
export function coerceEventDrafts(raw: unknown): ParsedEventDraft[] {
  const envelope = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const list = Array.isArray(raw) ? raw : Array.isArray(envelope.requests) ? envelope.requests : [raw];
  const transcript = readTranscript(raw);

  return list
    .map((item) => coerceEventDraft(item))
    .map((draft) => (draft.transcript ? draft : { ...draft, transcript }))
    .filter((draft) => draft.intent !== 'none');
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

function buildSystemPrompt(now: Date, memberNames: string[], contactNames: string[]): string {
  return (
    'You are the scheduling assistant inside a sales platform used by Indian real-estate agents. ' +
    `The user logs calendar events and tasks by typing or speaking (${INPUT_LANGUAGE_HINT}). ` +
    `Current date/time in India (IST): ${nowInIst(now)}.\n\n` +
    'From the given text or audio, extract EVERY separate thing the speaker wants done, as JSON:\n' +
    '{ "transcript": when the input is audio, the verbatim transcript translated to English; null for text input,\n' +
    '  "requests": [ ...one object per thing asked for, in the order spoken... ] }\n\n' +
    'Each object in "requests" has exactly these keys:\n' +
    '{\n' +
    '  "intent": "schedule" (has a specific date/time to be on a calendar) | "task" (a to-do, possibly with just a due date) | "notify" (the speaker wants a TEAM MEMBER TOLD something — "send Sharan the update on the Kusumaraju meeting", "let Priya know the site visit is off") | "none" (not a request at all),\n' +
    '  "title": short imperative summary WITHOUT the date/time words, e.g. "Site visit with Varun - JP Nagar plot",\n' +
    '  "event_type": one of "site_visit" | "call" | "follow_up" | "document" | "meeting" | "other",\n' +
    '  "start_time": "YYYY-MM-DDTHH:mm" in IST local time, resolving relative phrases like "tomorrow evening" (evening=17:00, morning=10:00, afternoon=14:00, night=20:00), or null,\n' +
    '  "day_of_week": the weekday word the message itself uses ("monday", "fri", "this Saturday" -> "saturday"), or null. Copy the word you actually read — never a weekday you worked out from a calendar date, and null when the message gives a date like "30th July" or a relative day like "tomorrow" instead of naming a weekday,\n' +
    '  "end_time": "YYYY-MM-DDTHH:mm" IST or null,\n' +
    '  "duration_minutes": number or null,\n' +
    '  "contact_name": the client/lead person the event is with, or null,\n' +
    '  "counterparty_name": when the request came out of a conversation with someone, the OTHER person in it — the one arranging the meeting rather than the one being met ("Yes Sharan, its confirmed" -> "Sharan"). Null when there is no such person or they are the same as contact_name,\n' +
    '  "service_provider_role": the professional role named alongside contact_name when there is one — "lawyer", "advocate", "surveyor", "architect", "CA", "khata agent", "registrar", "engineer", "contractor", "valuer" ("meeting with Kusuma lawyer" -> "lawyer"). Null when contact_name is a buyer, seller, owner or plain client,\n' +
    '  "property_hint": any property/project/locality identifying words, e.g. "18k sqft JP Nagar commercial", or null,\n' +
    '  "assignee_name": a TEAM member the speaker assigns this to ("ask Surya to...", "Surya should call..."), or null when the speaker will do it themselves,\n' +
    '  "recipient_name": for intent "notify" ONLY — the teammate or client/contact to be told. Null for every other intent,\n' +
    '  "location": meeting place or address if stated, or null,\n' +
    '  "priority": "low" | "medium" | "high" (urgent words like "pakka", "important", "urgent", "asap" mean high),\n' +
    '  "notes": any remaining useful detail, or null\n' +
    '}\n\n' +
    (memberNames.length > 0
      ? `Team member names for assignee matching: ${memberNames.join(', ')}.\n`
      : '') +
    (contactNames.length > 0
      ? `Client/contact names for contact matching: ${contactNames.join(', ')}.\n`
      : '') +
    'Splitting: one entry per thing the speaker wants done, and NEVER more. One event keeps all of its own ' +
    'detail together — "site visit with Varun tomorrow 4pm at the JP Nagar plot" is ONE request, not one per ' +
    'person, time and place. Split only when the actions are genuinely separate and could be done by different ' +
    'people on different days: "Send Sharan the update on the Kusumaraju meeting. The advocate is away a week, ' +
    'so follow up after that" is TWO — a "notify" for Sharan carrying what happened, and a "task" for the ' +
    'follow-up. Context a later request needs is repeated into it rather than left behind in an earlier one. ' +
    'Return an empty "requests" array when there is nothing to act on.\n' +
    'Rules: never invent a date/time that was not implied. "Remind me to X" with no time is intent "task". ' +
    'A stated calendar date with no time of day ("meet the lawyer on 30th July") IS intent "schedule" — ' +
    'use 10:00 as the hour, the same default as "morning", rather than midnight. ' +
    'A forwarded property listing or a lead\'s contact details is intent "none". ' +
    'Use intent "notify" when the named recipient appears in the supplied team member names and/or the ' +
    'supplied client/contact names. Use "task" for work to be done internally when no recipient is stated. ' +
    'When a name appears in both lists, preserve it in recipient_name so the application can ask which person was meant.' +
    ' "Need to inform a client" is a notify when the recipient is that client (not a "task"), and the same wording about ' +
    'teammates sends a teammate ping. ' +
    'For intent "notify", "title" is the subject line and "notes" carries everything the recipient needs to ' +
    'know — they see only those two and cannot hear the original message. Telling someone about a meeting is ' +
    '"notify"; being asked to do the work is "task" with assignee_name. ' +
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
  'Set contact_name to the person the appointment is WITH. When one name is the person being met and another is merely the person chatting, prefer the one being met, and put the person chatting in counterparty_name — both are attendees worth linking, and the one chatting is usually the one already in the contact database.\n' +
  'Put the conversation you read, as plain text, into "transcript".\n' +
  'If the thread never settles on a specific day or time, or is not about arranging a meeting at all, return intent "none" rather than guessing a slot.';

export interface EventParseInput {
  text?: string;
  audio?: { base64: string; mimeType: string };
  image?: { base64: string; mimeType: string };
  memberNames?: string[];
  contactNames?: string[];
  now?: Date;
}

/**
 * Every request the input carries, in the order they were spoken.
 *
 * One voice note is routinely two jobs — "tell Sharan what happened, and
 * remind me to chase it next week" — and returning the first one silently
 * dropped the rest. Only the WhatsApp owner path consumes the full array
 * today; parseEventFromInput below keeps the single-draft contract for the
 * callers whose UI shows exactly one card.
 */
export async function parseEventsFromInput(input: EventParseInput): Promise<ParsedEventDraft[]> {
  return (await runEventParse(input)).drafts;
}

/**
 * The first request, or a "none" draft when there is nothing to act on.
 * The transcript survives an empty result — a caller that found no request
 * still wants to show the agent what was heard.
 */
export async function parseEventFromInput(input: EventParseInput): Promise<ParsedEventDraft> {
  const { drafts, transcript } = await runEventParse(input);
  return drafts[0] || { ...coerceEventDraft({}), transcript };
}

async function runEventParse(
  input: EventParseInput
): Promise<{ drafts: ParsedEventDraft[]; transcript: string | null }> {
  const parts: GeminiPart[] = [];
  if (input.audio) {
    const mimeType = input.audio.mimeType.split(';')[0].trim() || 'audio/ogg';
    parts.push({ inlineData: { mimeType, data: input.audio.base64 } });
    parts.push({ text: 'Extract every request from this voice note.' });
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
    buildSystemPrompt(input.now || new Date(), input.memberNames || [], input.contactNames || []),
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
  const now = input.now || new Date();
  const drafts = coerceEventDrafts(parsed);
  return {
    // Weekday arithmetic is the one part of the extraction the model gets
    // wrong often enough to matter, so it is redone here deterministically
    // for every input path — typed, spoken and screenshotted alike.
    drafts: drafts.map((draft) => alignDraftToNamedWeekday(draft, now)),
    transcript: drafts[0]?.transcript || readTranscript(parsed),
  };
}

export interface EventUpdateInput {
  current: {
    title: string;
    event_type: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    agenda: string | null;
  };
  instruction: string;
  memberNames?: string[];
  now?: Date;
}

/**
 * Applies a correction typed against a confirmation card ("change this
 * to Monday 5pm, retitle it X") to the event that card announced.
 *
 * Mirrors updateListingDraft/updateContactDraft in gemini.ts: the model
 * returns the WHOLE event as it should now read, so untouched fields
 * come back unchanged rather than nulled. The same deterministic
 * weekday alignment runs afterwards, since a correction naming a day is
 * exactly where the model's date arithmetic slipped in the first place.
 */
export async function parseEventUpdate(input: EventUpdateInput): Promise<ParsedEventDraft> {
  const now = input.now || new Date();
  const system =
    'You are the scheduling assistant inside a sales platform used by Indian real-estate agents. ' +
    `Current date/time in India (IST): ${nowInIst(now)}.\n\n` +
    'The user is correcting an event that already exists. Apply their instruction to it and return the FULL event as it should now read, ' +
    'in the same JSON shape used for new events (intent, title, event_type, start_time, day_of_week, end_time, duration_minutes, contact_name, property_hint, assignee_name, location, priority, notes, transcript).\n' +
    'Carry every field the instruction does not mention through UNCHANGED — never blank a field just because it went unmentioned. ' +
    'Set intent to "schedule" whenever the event still has a date/time, "task" when it has become a plain to-do, and "none" only when the instruction is not a correction at all.\n' +
    'The day_of_week rule is unchanged: copy a weekday word the instruction actually uses, else null.\n\n' +
    `Existing event:\n${JSON.stringify(input.current, null, 2)}\n\n` +
    (input.memberNames?.length ? `Team member names: ${input.memberNames.join(', ')}.\n` : '') +
    'Respond with ONLY the JSON object.';

  const raw = await generateJsonFromParts(
    [{ text: input.instruction }],
    system,
    { tier: 'lite', feature: 'event_parse' }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }
  return alignDraftToNamedWeekday(coerceEventDraft(parsed), now);
}

// ── Deterministic reference resolution ──────────────────────────

export interface NamedRef {
  id: string;
  label: string;
}

/** Shortest run treated as a real name fragment. Below this a substring
 *  hit is noise — two letters land inside somebody in any list. */
const MIN_FRAGMENT = 3;

/**
 * A substring hit that starts where a word starts.
 *
 * Plain `includes` matched "Raj" against "Kusumaraju", filing an advocate's
 * meeting under an unrelated contact and — because the liaisons lookup only
 * runs when no contact matched — hiding the advocate we should have found
 * instead. Requiring the fragment to begin a word keeps every real partial
 * ("Kumar" in "Raj Kumar", a property code opening a label) and drops the
 * ones that merely happen to fall inside a longer name.
 */
function containsFragment(haystack: string, needle: string): boolean {
  if (needle.length < MIN_FRAGMENT) return false;
  for (let from = 0; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (at === 0 || !/[a-z0-9]/i.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

/** Case-insensitive best match: exact > startsWith > word-boundary
 *  substring > all-words-included. Returns null rather than guessing badly. */
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
    else if (containsFragment(label, q) || containsFragment(q, label)) score = 2;
    else {
      const words = q.split(/\s+/).filter((w) => w.length >= MIN_FRAGMENT);
      if (words.length > 0 && words.every((w) => containsFragment(label, w))) score = 1;
    }
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}
