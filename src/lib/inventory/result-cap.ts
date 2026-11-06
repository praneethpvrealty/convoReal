export function cappedResultsNotice(
  shown: number,
  total: number | null | undefined,
  noun = 'listings'
): string | null {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  if (total <= shown || shown <= 0) return null;
  return `Showing the first ${shown} of ${total} ${noun}`;
}
