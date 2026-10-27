const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(
  dateString: string | null | undefined,
  now: number = Date.now()
): number | null {
  if (!dateString) return null;
  const at = new Date(dateString).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}
