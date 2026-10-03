/**
 * The undo bar's pending entries. Every destructive action keeps its own
 * Undo for its full window: a newer action goes on top of the stack
 * rather than replacing the one before it, and when the visible entry is
 * undone or expires the next most recent one shows again.
 */

export interface UndoEntryLike {
  key: number;
  expiresAt: number;
}

export function pushUndoEntry<T extends UndoEntryLike>(
  entries: readonly T[],
  entry: T
): T[] {
  return [...entries, entry];
}

export function removeUndoEntry<T extends UndoEntryLike>(
  entries: readonly T[],
  key: number
): T[] {
  return entries.filter((entry) => entry.key !== key);
}

export function liveUndoEntries<T extends UndoEntryLike>(
  entries: readonly T[],
  now: number
): T[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

/** The most recent pending entry is the one the bar shows. */
export function visibleUndoEntry<T extends UndoEntryLike>(
  entries: readonly T[]
): T | null {
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

export function undoBarLabel(message: string, pendingCount: number): string {
  return pendingCount > 1 ? `${message} · ${pendingCount - 1} more` : message;
}
