export const MAX_SHORTLIST_PROPERTIES = 20;

export function readShortlistIds(
  raw: string | null,
  availableIds: string[]
): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    const available = new Set(availableIds);
    return [
      ...new Set(
        parsed.filter(
          (id): id is string => typeof id === 'string' && available.has(id)
        )
      ),
    ].slice(0, MAX_SHORTLIST_PROPERTIES);
  } catch {
    return [];
  }
}

export function parseInquiryPropertyIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_SHORTLIST_PROPERTIES
  )
    return null;
  if (
    !value.every(
      (id) =>
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
    )
  )
    return null;
  return [...new Set(value.map((id: string) => id.toLowerCase()))];
}
