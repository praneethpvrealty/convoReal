// CRM-display full name. Outbound messages must keep using `name` alone
// (the first name) — never this helper (migration 166).
export function contactFullName(contact: {
  name?: string | null;
  second_name?: string | null;
}): string {
  return [contact.name, contact.second_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}
