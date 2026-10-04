interface ReferralRow {
  source_id: string | null;
  contact_id: string | null;
}

export function countDistinctContactsByAd(
  rows: ReferralRow[]
): Map<string, number> {
  const contactsByAd = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.source_id || !row.contact_id) continue;
    const contacts = contactsByAd.get(row.source_id) ?? new Set<string>();
    contacts.add(row.contact_id);
    contactsByAd.set(row.source_id, contacts);
  }
  return new Map(
    [...contactsByAd].map(([adId, contacts]) => [adId, contacts.size])
  );
}
