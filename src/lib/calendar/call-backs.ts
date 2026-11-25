/**
 * The call-backs list (CAL-024): open Call events the agent scheduled,
 * grouped so the overdue ones come first. Shared at runtime by web and
 * mobile through `@shared/`, so it must stay free of imports.
 */

export const CALL_BACK_EVENT_TYPE = 'call' as const;
export const CALL_BACK_DEFAULT_TITLE = 'Call back';
export const CALL_BACK_LOOKBACK_DAYS = 30;
export const CALL_BACK_LIMIT = 200;
export const CALL_BACKS_QUERY_KEY = ['call-backs'];

export interface CallBackLike {
  id: string;
  start_time: string;
}

export type CallBackBucket = 'overdue' | 'today' | 'upcoming';

export const CALL_BACK_BUCKET_LABELS: Record<CallBackBucket, string> = {
  overdue: 'Overdue',
  today: 'Later today',
  upcoming: 'Upcoming',
};

export function callBackLookbackStart(now: Date): string {
  return new Date(
    now.getTime() - CALL_BACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function callBackBucket(startTime: string, now: Date): CallBackBucket {
  const start = new Date(startTime);
  if (start.getTime() < now.getTime()) return 'overdue';
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return start.getTime() <= endOfToday.getTime() ? 'today' : 'upcoming';
}

export function groupCallBacks<T extends CallBackLike>(
  callBacks: readonly T[],
  now: Date
): { bucket: CallBackBucket; label: string; items: T[] }[] {
  const sorted = [...callBacks].sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime() ||
      a.id.localeCompare(b.id)
  );
  const order: CallBackBucket[] = ['overdue', 'today', 'upcoming'];
  return order
    .map((bucket) => ({
      bucket,
      label: CALL_BACK_BUCKET_LABELS[bucket],
      items: sorted.filter((c) => callBackBucket(c.start_time, now) === bucket),
    }))
    .filter((group) => group.items.length > 0);
}
