import type { Contact } from '@/types';

export const DEFAULT_SHARE_RECIPIENT_COUNT = 8;

type RecipientFields = Pick<
  Contact,
  'id' | 'name' | 'phone' | 'last_contacted_at' | 'updated_at'
>;

function activityTime(contact: RecipientFields): number {
  const stamp = contact.last_contacted_at ?? contact.updated_at;
  const time = stamp ? Date.parse(stamp) : NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function hasRealName(contact: Pick<Contact, 'name' | 'phone'>): boolean {
  const name = contact.name?.trim();
  if (!name) return false;
  const digits = name.replace(/\D/g, '');
  const phoneDigits = (contact.phone ?? '').replace(/\D/g, '');
  return !(digits.length >= 7 && digits === phoneDigits);
}

export function defaultShareRecipients<T extends RecipientFields>(
  contacts: T[],
  limit: number = DEFAULT_SHARE_RECIPIENT_COUNT
): T[] {
  return [...contacts]
    .sort((a, b) => {
      const byActivity = activityTime(b) - activityTime(a);
      if (byActivity !== 0) return byActivity;
      const byName = Number(hasRealName(b)) - Number(hasRealName(a));
      if (byName !== 0) return byName;
      return (a.name ?? '').localeCompare(b.name ?? '');
    })
    .slice(0, limit);
}
