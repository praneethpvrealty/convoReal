import type { Contact } from '@/lib/types';

export interface MergePreviewContact {
  id: string;
  name?: string | null;
  phone: string | null;
  secondary_phones?: string[] | null;
  email?: string | null;
  company?: string | null;
  classification?: Contact['classification'] | null;
  requirements?: string | null;
}

export function mergeContactLabel(contact: MergePreviewContact): string {
  return contact.name?.trim() || contact.phone || 'Unnamed contact';
}

function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function mergedPhonePreview(
  source: MergePreviewContact,
  target: MergePreviewContact
): { primary: string; other: string[] } {
  const primary = target.phone?.trim() || 'No primary phone';
  const primaryKey = phoneKey(primary);
  const seen = new Set<string>();
  const other: string[] = [];

  for (const raw of [
    ...(target.secondary_phones ?? []),
    source.phone,
    ...(source.secondary_phones ?? []),
  ]) {
    const phone = raw?.trim();
    if (!phone) continue;
    const key = phoneKey(phone);
    if (key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    other.push(phone);
  }

  return { primary, other };
}
