export const JOURNEY_ENQUIRY_SELECT =
  'id, inquiry_source, inquiry_date, created_at, property:properties(id, title, property_code, location), contact:contacts(id, name, phone)';

export interface JourneyEnquiryRow {
  id: string;
  inquiry_source: string | null;
  inquiry_date: string | null;
  created_at: string | null;
  property: {
    id: string;
    title: string | null;
    property_code: string | null;
    location: string | null;
  } | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
}

export interface JourneyEnquiryEntry {
  id: string;
  targetId: string | null;
  title: string;
  subtitle: string;
  source: string | null;
  enquiredAt: string | null;
}

export function journeyEnquiryEntries(
  rows: JourneyEnquiryRow[],
  mode: 'buyer' | 'property'
): JourneyEnquiryEntry[] {
  return rows
    .map((row) => {
      const enquiredAt = row.inquiry_date ?? row.created_at;
      if (mode === 'buyer') {
        return {
          id: row.id,
          targetId: row.property?.id ?? null,
          title: row.property?.title || 'Unknown property',
          subtitle: [row.property?.property_code, row.property?.location]
            .filter(Boolean)
            .join(' · '),
          source: row.inquiry_source,
          enquiredAt,
        };
      }
      return {
        id: row.id,
        targetId: row.contact?.id ?? null,
        title: row.contact?.name || row.contact?.phone || 'Unknown contact',
        subtitle: row.contact?.name ? (row.contact.phone ?? '') : '',
        source: row.inquiry_source,
        enquiredAt,
      };
    })
    .sort((a, b) => (b.enquiredAt ?? '').localeCompare(a.enquiredAt ?? ''));
}
