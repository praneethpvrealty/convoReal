export const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;
export const MIN_EVENT_DURATION_MS = 15 * 60 * 1000;
export const PAST_START_GRACE_MS = 60 * 1000;

export const PAST_START_CONFIRM = {
  title: 'This time has already passed',
  message:
    'The event starts in the past, so no WhatsApp reminders will be sent for it. Save it anyway?',
  confirmLabel: 'Save anyway',
} as const;

export function eventDurationMs(
  startTime: string,
  endTime: string | null | undefined
): number {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return DEFAULT_EVENT_DURATION_MS;
  }
  return Math.max(end - start, MIN_EVENT_DURATION_MS);
}

export function movedEventEnd(
  startTime: string,
  endTime: string | null | undefined,
  newStart: Date
): Date {
  return new Date(newStart.getTime() + eventDurationMs(startTime, endTime));
}

export function startsInPast(start: Date, now: Date = new Date()): boolean {
  return start.getTime() < now.getTime() - PAST_START_GRACE_MS;
}
