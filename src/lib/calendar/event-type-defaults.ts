export const EVENT_TYPE_ORDER = [
  'site_visit',
  'call',
  'follow_up',
  'document',
  'meeting',
  'other',
] as const;

export type EventTypeValue = (typeof EVENT_TYPE_ORDER)[number];

export const DEFAULT_EVENT_TYPE: EventTypeValue = 'meeting';

export function eventTypeFromParam(value: string | undefined): EventTypeValue {
  return (EVENT_TYPE_ORDER as readonly string[]).includes(value ?? '')
    ? (value as EventTypeValue)
    : DEFAULT_EVENT_TYPE;
}
