export const PULSE_FEED_PAGE_SIZE = 200;

export interface PulseFeedCursor {
  createdAt: string;
  id: string;
}

export function pulseFeedCursorFilter(cursor: PulseFeedCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export function nextPulseFeedCursor(
  rows: ReadonlyArray<{ id: string; created_at: string }>,
  pageSize: number = PULSE_FEED_PAGE_SIZE
): PulseFeedCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { createdAt: last.created_at, id: last.id };
}
