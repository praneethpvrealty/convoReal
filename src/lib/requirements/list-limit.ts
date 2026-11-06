export const REQUIREMENTS_LIST_LIMIT = 1000;

export const REQUIREMENTS_TOTAL_HEADER = 'X-Total-Count';

export function requirementsTruncationNotice(
  shown: number,
  total: number
): string | null {
  if (total <= shown) return null;
  return `Showing the newest ${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} requirements.`;
}
