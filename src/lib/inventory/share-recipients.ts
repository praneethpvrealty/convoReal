export const DEFAULT_SHARE_RECIPIENT_COUNT = 8;

interface RecipientFields {
  id: string;
  name?: string | null;
  phone?: string | null;
  last_contacted_at?: string | null;
}

function contactedAt(contact: RecipientFields): number {
  const time = contact.last_contacted_at
    ? Date.parse(contact.last_contacted_at)
    : NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function hasRealName(contact: {
  name?: string | null;
  phone?: string | null;
}): boolean {
  const name = contact.name?.trim();
  if (!name) return false;
  if (!/^[\d\s+\-().]+$/.test(name)) return true;
  const nameDigits = name.replace(/\D/g, '');
  const phoneDigits = (contact.phone ?? '').replace(/\D/g, '');
  if (nameDigits.length < 7 || !phoneDigits) return true;
  if (nameDigits === phoneDigits) return false;
  return !(
    nameDigits.length >= 8 &&
    phoneDigits.length >= 8 &&
    nameDigits.slice(-8) === phoneDigits.slice(-8)
  );
}

export function defaultShareRecipients<T extends RecipientFields>(
  contacts: T[],
  limit: number = DEFAULT_SHARE_RECIPIENT_COUNT
): T[] {
  return [...contacts]
    .sort((a, b) => {
      const byContact = contactedAt(b) - contactedAt(a);
      if (byContact !== 0) return byContact;
      const byName = Number(hasRealName(b)) - Number(hasRealName(a));
      if (byName !== 0) return byName;
      return (a.name ?? '').localeCompare(b.name ?? '');
    })
    .slice(0, limit);
}
