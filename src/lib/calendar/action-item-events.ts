// ============================================================
// Action items → calendar events. Turns the action items of an
// analyzed call ("Lawyer: send sale deed draft by 2:00 PM today")
// into structured event/task drafts plus the service provider the
// call was with, so the create-events route can schedule them and
// wire up reminders. Same split as calendar/event-parse: one
// Gemini call, then deterministic, unit-testable coercion.
// ============================================================

import { generateJsonFromParts } from '@/lib/ai/gemini';
import {
  normalizeEventType,
  nowInIst,
  type EventTypeKey,
} from '@/lib/calendar/event-parse';

export interface ActionItemEventDraft {
  title: string;
  event_type: EventTypeKey;
  /** "YYYY-MM-DDTHH:mm" IST local, null when the item has no stated time. */
  start_time: string | null;
  notes: string | null;
}

export interface ActionItemEventsResult {
  events: ActionItemEventDraft[];
  liaison_name: string | null;
  liaison_role: string | null;
}

export function coerceActionItemEvents(raw: unknown): ActionItemEventsResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

  const events: ActionItemEventDraft[] = Array.isArray(obj.events)
    ? obj.events
        .map((item) => {
          const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          const title = str(e.title);
          if (!title) return null;
          const start = str(e.start_time);
          return {
            title,
            event_type: normalizeEventType(str(e.event_type)),
            start_time: start && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(start) ? start : null,
            notes: str(e.notes),
          };
        })
        .filter((e): e is ActionItemEventDraft => e !== null)
    : [];

  return {
    events,
    liaison_name: str(obj.liaison_name),
    liaison_role: str(obj.liaison_role),
  };
}

function buildSystemPrompt(contactName: string | null, now: Date): string {
  return (
    'You are the scheduling assistant inside a sales platform used by Indian real-estate agents. ' +
    'The agent analyzed a phone call made on behalf of a client' +
    (contactName ? ` (the client is ${contactName})` : '') +
    ', often with a third party such as a lawyer, surveyor, registrar or banker. ' +
    'You are given the action items from that call. Turn EACH action item into one calendar entry.\n' +
    `Current date/time in India (IST): ${nowInIst(now)}.\n\n` +
    'Return JSON with exactly these keys:\n' +
    '{\n' +
    '  "events": [\n' +
    '    {\n' +
    '      "title": short imperative summary naming who does what, WITHOUT the date/time words (e.g. "Lawyer to send sale deed draft"),\n' +
    '      "event_type": one of "site_visit" | "call" | "follow_up" | "document" | "meeting" | "other" — document work (deeds, reports, khata, EC, agreements) is "document",\n' +
    '      "start_time": "YYYY-MM-DDTHH:mm" in IST local time for the stated deadline, resolving relative phrases like "by 2:00 PM today" or "in the evening today" (morning=10:00, afternoon=14:00, evening=17:00, night=20:00), or null when the item states no day or time at all,\n' +
    '      "notes": any remaining useful detail from the item, or null\n' +
    '    }\n' +
    '  ],\n' +
    '  "liaison_name": the personal name of the service provider these items involve, read from the action items or context (e.g. "Vijayasathi"), or null when no name is given,\n' +
    '  "liaison_role": their professional role in lowercase ("lawyer", "surveyor", "khata agent", "CA", "banker"), or null\n' +
    '}\n\n' +
    'Rules: one entry per action item, in the same order. Never invent a date/time that was not implied — ' +
    'use null start_time instead. Never merge or drop items. Respond with ONLY the JSON object.'
  );
}

export interface ActionItemEventsInput {
  actionItems: string[];
  /** Call summary / context lines that help name the service provider. */
  context?: string | null;
  contactName?: string | null;
  now?: Date;
}

export async function parseActionItemEvents(
  input: ActionItemEventsInput
): Promise<ActionItemEventsResult> {
  if (input.actionItems.length === 0) {
    return { events: [], liaison_name: null, liaison_role: null };
  }

  const prompt =
    `Action items:\n${input.actionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}` +
    (input.context ? `\n\nContext from the call:\n${input.context}` : '');

  const raw = await generateJsonFromParts(
    [{ text: prompt }],
    buildSystemPrompt(input.contactName || null, input.now || new Date()),
    { tier: 'lite', feature: 'action_item_events' }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }
  return coerceActionItemEvents(parsed);
}
