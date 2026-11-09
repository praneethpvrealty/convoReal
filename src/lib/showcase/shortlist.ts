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

export function buildShortlistWhatsAppMessage(
  properties: Array<{
    title: string;
    property_code?: string | null;
    location?: string | null;
  }>
): string {
  const lines = properties.map(
    (property, index) =>
      `${index + 1}. ${property.title}${property.property_code ? ` (Property ID: ${property.property_code})` : ''}`
  );
  return [
    `Hi! I have shortlisted ${properties.length === 1 ? 'this property' : `these ${properties.length} properties`} on your showcase:`,
    ...lines,
    'Please share details and availability.',
  ].join('\n');
}

export function shortlistWhatsAppLink(
  phone: string,
  properties: Parameters<typeof buildShortlistWhatsAppMessage>[0]
): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(buildShortlistWhatsAppMessage(properties))}`;
}
