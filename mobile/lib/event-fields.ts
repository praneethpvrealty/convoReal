// Mirrors EVENT_TYPE_FIELDS in src/components/calendar/event-types.ts.
//
// Each event type carries only the note fields that make sense for it:
// "pre" fields are filled while planning (and ride along on the
// assignee's pre-event WhatsApp brief); "post" fields are for logging
// what happened. A site visit deliberately has no agenda/minutes —
// just the visit outcome.

import type { AppointmentType } from '@/lib/types';

export type EventFieldKey = 'agenda' | 'minutes' | 'outcome';
export type EventFieldPhase = 'pre' | 'post';

export interface EventExtraField {
  key: EventFieldKey;
  label: string;
  placeholder: string;
  phase: EventFieldPhase;
}

export const EVENT_TYPE_FIELDS: Record<AppointmentType, EventExtraField[]> = {
  meeting: [
    { key: 'agenda', label: 'Agenda', placeholder: 'Points to discuss, decisions needed…', phase: 'pre' },
    { key: 'minutes', label: 'Minutes of the meeting', placeholder: 'What was discussed and decided…', phase: 'post' },
  ],
  call: [
    { key: 'agenda', label: 'Call agenda / talking points', placeholder: 'What to cover on the call…', phase: 'pre' },
    { key: 'minutes', label: 'Call notes / minutes', placeholder: 'How the call went, what was agreed…', phase: 'post' },
  ],
  follow_up: [
    { key: 'agenda', label: 'What to follow up on', placeholder: 'Pending items to chase…', phase: 'pre' },
    { key: 'outcome', label: 'Outcome / next step', placeholder: 'Result of the follow-up and what happens next…', phase: 'post' },
  ],
  site_visit: [
    { key: 'outcome', label: 'Visit feedback / outcome', placeholder: "Client's reaction, objections, interest level…", phase: 'post' },
  ],
  document: [
    { key: 'agenda', label: 'Documents to prepare / carry', placeholder: 'EC, khata, sale deed, ID proofs…', phase: 'pre' },
    { key: 'outcome', label: 'Outcome / status', placeholder: 'What was verified, signed, or is still pending…', phase: 'post' },
  ],
  other: [
    { key: 'agenda', label: 'Agenda', placeholder: 'Points to cover…', phase: 'pre' },
    { key: 'minutes', label: 'Notes / minutes', placeholder: 'What happened…', phase: 'post' },
  ],
};

export function eventTypeFields(key?: string | null): EventExtraField[] {
  return EVENT_TYPE_FIELDS[(key as AppointmentType) || 'other'] || EVENT_TYPE_FIELDS.other;
}
