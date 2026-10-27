export const EVENT_TYPE_ORDER = [
  'site_visit',
  'call',
  'follow_up',
  'document',
  'meeting',
  'other',
] as const;

export type EventTypeValue = (typeof EVENT_TYPE_ORDER)[number];

export const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  site_visit: 'Site visit',
  call: 'Call',
  follow_up: 'Follow-up',
  document: 'Documents',
  meeting: 'Meeting',
  other: 'Other',
};

export const DEFAULT_EVENT_TYPE: EventTypeValue = 'meeting';

export function eventTypeFromParam(value: string | undefined): EventTypeValue {
  return (EVENT_TYPE_ORDER as readonly string[]).includes(value ?? '')
    ? (value as EventTypeValue)
    : DEFAULT_EVENT_TYPE;
}
