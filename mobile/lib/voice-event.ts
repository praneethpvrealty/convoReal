import type { AppointmentType, Contact } from './types';

/**
 * Mobile mirror of the web SmartAddBar's contract with
 * POST /api/ai/parse-event (src/app/api/ai/parse-event/route.ts):
 * Gemini transcribes + extracts the draft, the server resolves the
 * contact against the account. Everything here is pure so it runs
 * under the plain-Node test runner.
 */
export interface ParsedEventResponse {
  draft: {
    intent: 'schedule' | 'task' | 'none';
    title: string;
    event_type: string;
    priority: 'low' | 'medium' | 'high';
    location: string | null;
    notes: string | null;
    transcript: string | null;
    contact_name: string | null;
  };
  resolved: {
    start_time: string | null;
    end_time: string | null;
    contact: { id: string; name: string; phone: string; name_tag?: string | null } | null;
  } | null;
}

export interface VoicePrefill {
  title: string;
  eventType: AppointmentType;
  start: Date | null;
  location: string | null;
  contact: Contact | null;
  description: string | null;
  transcript: string | null;
  unmatchedContactName: string | null;
}

/** The four types the New-appointment chips can display. */
const CHIP_TYPES: AppointmentType[] = ['site_visit', 'meeting', 'call', 'follow_up'];

export function prefillFromParse(parsed: ParsedEventResponse): VoicePrefill | null {
  if (parsed.draft.intent === 'none') return null;

  const rawType = parsed.draft.event_type as AppointmentType;
  const eventType = CHIP_TYPES.includes(rawType) ? rawType : 'meeting';

  const startIso = parsed.resolved?.start_time ?? null;
  const startDate = startIso ? new Date(startIso) : null;
  const start = startDate && !isNaN(startDate.getTime()) ? startDate : null;

  const resolvedContact = parsed.resolved?.contact ?? null;
  const contact = resolvedContact
    ? ({
        id: resolvedContact.id,
        name: resolvedContact.name,
        phone: resolvedContact.phone,
        name_tag: resolvedContact.name_tag ?? null,
      } as Contact)
    : null;

  return {
    title: parsed.draft.title,
    eventType,
    start,
    location: parsed.draft.location,
    contact,
    description: parsed.draft.notes,
    transcript: parsed.draft.transcript,
    unmatchedContactName: contact ? null : parsed.draft.contact_name,
  };
}

/** Follow-up nudges shown after the form is filled from voice. */
export function voiceHints(prefill: VoicePrefill): string[] {
  const hints: string[] = [];
  if (!prefill.start) {
    hints.push('No date or time heard — set it below before scheduling.');
  }
  if (prefill.unmatchedContactName) {
    hints.push(`"${prefill.unmatchedContactName}" didn't match a contact — attach one manually.`);
  }
  return hints;
}

export function formatRecordingDuration(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
