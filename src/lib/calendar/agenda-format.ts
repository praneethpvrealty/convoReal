export interface AgendaContact {
  id?: string | null;
  name: string | null;
  phone?: string | null;
}

export interface AgendaProperty {
  id: string;
  title?: string | null;
  property_code?: string | null;
}

const DEFAULT_COUNTRY_CODE =
  process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || '91';

export function callablePhone(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (raw.startsWith('00')) {
    const intl = digits.slice(2);
    return intl.length >= 8 ? `+${intl}` : null;
  }
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }
  return `+${digits}`;
}

export function agendaItemTitle(
  title: string,
  contact: AgendaContact | null | undefined,
  property?: AgendaProperty | null
): string {
  let clean = title.trim();
  const propertyTitle = property?.title?.trim();
  if (propertyTitle) {
    const at = clean.lastIndexOf(propertyTitle);
    const lead = at > 0 ? clean.slice(0, at) : '';
    const tail = at > 0 ? clean.slice(at + propertyTitle.length).trim() : '';
    const head = lead.replace(/\s*[-–—:]\s*$/, '').trim();
    const trailing = tail === '' || /^\([^()]*\)$/.test(tail);
    if (trailing && head && head !== lead.trim()) clean = head;
  }
  if (!contact?.name) return clean;
  const stripped = clean.replace(/\s*[-–—:]\s*@[^@]+$/, '').trim();
  return stripped || clean;
}

export function propertyLine(
  property: AgendaProperty | null | undefined
): string | null {
  if (!property) return null;
  const title = property.title?.trim() || null;
  const code = property.property_code?.trim() || null;
  if (title && code) return `🏠 ${title} (${code})`;
  if (title || code) return `🏠 ${title || code}`;
  return null;
}

export function agendaLinkLine(
  siteUrl: string | null | undefined,
  title: string,
  contact: AgendaContact | null | undefined,
  property: AgendaProperty | null | undefined
): string | null {
  const site = siteUrl?.trim().replace(/\/+$/, '');
  if (!site) return null;
  if (property?.id) {
    return `🔗 ${site}/inventory?propertyId=${encodeURIComponent(property.id)}`;
  }
  if (!contact?.id) return null;
  const url = `${site}/contacts?contactId=${encodeURIComponent(contact.id)}`;
  return /requirement/i.test(title) ? `📋 Requirements: ${url}` : `🔗 ${url}`;
}

export function contactLine(
  contact: AgendaContact | null | undefined
): string | null {
  if (!contact) return null;
  const name = contact.name?.trim() || null;
  const phone = callablePhone(contact.phone);
  if (name && phone) return `👤 ${name} · 📞 ${phone}`;
  if (phone) return `📞 ${phone}`;
  if (name) return `👤 ${name}`;
  return null;
}

export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
