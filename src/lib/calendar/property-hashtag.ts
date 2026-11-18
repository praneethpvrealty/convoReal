const TRAILING_TAG = /(^|\s)#([^\s#]*)$/;

export function trailingPropertyTag(title: string): string | null {
  const match = TRAILING_TAG.exec(title);
  return match ? match[2] : null;
}

export function stripPropertyTag(title: string): string {
  return title.replace(TRAILING_TAG, '').trimEnd();
}

export function propertySearchTerm(raw: string): string {
  return raw
    .replace(/[%_,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TaggableProperty {
  title: string;
  property_code?: string | null;
  location?: string | null;
  sublocality?: string | null;
}

export function matchesPropertyTag(
  property: TaggableProperty,
  tag: string
): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return [
    property.title,
    property.property_code,
    property.location,
    property.sublocality,
  ].some((field) => (field ?? '').toLowerCase().includes(needle));
}

export function titleForLinkedProperty(
  title: string,
  eventLabel: string,
  propertyTitle: string
): string {
  return title.trim() ? title : `${eventLabel} — ${propertyTitle}`;
}

export interface AreaProperty {
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
}

export function propertyArea(property: AreaProperty): string {
  return (
    [property.sublocality, property.city].filter(Boolean).join(', ') ||
    property.location ||
    ''
  );
}
