export const RECENT_SHARE_WINDOW_HOURS = 24;
export const RECENTLY_SHARED_CODE = 'RECENTLY_SHARED';

export function recentShareSince(now: Date = new Date()): string {
  return new Date(
    now.getTime() - RECENT_SHARE_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();
}

export function recentShareFilter(since: string): string {
  return `last_shared_at.gte.${since},created_at.gte.${since}`;
}

export function lastSharedAt(row: {
  created_at?: unknown;
  last_shared_at?: unknown;
}): string | null {
  const last =
    typeof row.last_shared_at === 'string' ? row.last_shared_at : null;
  const first = typeof row.created_at === 'string' ? row.created_at : null;
  return last ?? first;
}

export function sharedAgoLabel(
  sharedAt: string,
  now: Date = new Date()
): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(sharedAt).getTime()) / 60_000)
  );
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export function recentShareNotice(
  recipient: string,
  sharedAt: string,
  now: Date = new Date()
): string {
  return `${recipient} already got this listing ${sharedAgoLabel(sharedAt, now)}.`;
}

export function recentShareRefusal(
  code: unknown,
  data: unknown
): { sharedAt: string | null } | null {
  if (code !== RECENTLY_SHARED_CODE) return null;
  const sharedAt =
    data && typeof data === 'object' && 'shared_at' in data
      ? (data as { shared_at?: unknown }).shared_at
      : null;
  return { sharedAt: typeof sharedAt === 'string' ? sharedAt : null };
}
