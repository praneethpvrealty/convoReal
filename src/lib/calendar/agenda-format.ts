export interface AgendaContact {
  name: string | null;
  phone?: string | null;
}

const DEFAULT_COUNTRY_CODE =
  process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || '91';

export function callablePhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }
  return `+${digits}`;
}

export function agendaItemTitle(
  title: string,
  contact: AgendaContact | null | undefined
): string {
  const clean = title.trim();
  if (!contact?.name) return clean;
  const stripped = clean.replace(/\s*[-–—:]\s*@[^@]+$/, '').trim();
  return stripped || clean;
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
