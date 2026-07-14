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
    'A forwarded property listing or a lead\'s contact details is intent "none". ' +
    'Respond with ONLY the JSON object.'
  );
}

export interface EventParseInput {
  text?: string;
  audio?: { base64: string; mimeType: string };
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
  if (input.text) {
    parts.push({ text: input.text });
  }
  if (parts.length === 0) {
    throw new Error('parseEventFromInput requires text or audio');
  }

  const raw = await generateJsonFromParts(
    parts,
    buildSystemPrompt(input.now || new Date(), input.memberNames || [])
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }
  return coerceEventDraft(parsed);
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
