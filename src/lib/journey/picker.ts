export const PICKER_LIMIT = 200;

export function pickerTruncatedNotice(
  limit: number,
  noun: string,
  searching: boolean
): string {
  return searching
    ? `Showing the first ${limit} matching ${noun} — refine the search to narrow it.`
    : `Showing the first ${limit} ${noun} — type to search for the rest.`;
}
