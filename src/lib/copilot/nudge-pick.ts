export const NUDGE_GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const NUDGE_PER_NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function nudgeGlobalCooldownActive(
  lastShownAt: number,
  now = Date.now()
): boolean {
  return now - lastShownAt < NUDGE_GLOBAL_COOLDOWN_MS;
}

export function pickNudge<T extends { id: string }>(
  nudges: T[],
  seen: Record<string, number>,
  now = Date.now()
): T | null {
  return (
    nudges.find((n) => now - (seen[n.id] ?? 0) > NUDGE_PER_NUDGE_COOLDOWN_MS) ??
    null
  );
}

export function markNudgeSeen(
  seen: Record<string, number>,
  id: string,
  now = Date.now()
): Record<string, number> {
  return { ...seen, [id]: now };
}
