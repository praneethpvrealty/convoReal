import type { SupabaseClient } from '@supabase/supabase-js';

import { phoneMatchKey } from './phone-key';

export const DUPLICATE_PHONE = 'DUPLICATE_PHONE';

export interface PhoneOwner {
  id: string;
  name: string | null;
  second_name: string | null;
  phone: string | null;
}

export function phoneLookupVariants(phone: string): string[] {
  const raw = phone.trim();
  const key = phoneMatchKey(raw);
  if (!key) return raw ? [raw] : [];
  const digits = raw.replace(/\D/g, '');
  return [
    ...new Set([
      raw,
      digits,
      `+${digits}`,
      key,
      `0${key}`,
      `91${key}`,
      `+91${key}`,
    ]),
  ];
}

export function pickPhoneOwner(
  phone: string,
  candidates: readonly PhoneOwner[]
): PhoneOwner | null {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  return candidates.find((c) => phoneMatchKey(c.phone) === key) ?? null;
}

export function duplicatePhoneMessage(owner: PhoneOwner): string {
  const fullName = [owner.name, owner.second_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return fullName
    ? `${fullName} is already saved with this number. Open that contact instead of adding a second one.`
    : 'A contact with this number is already saved. Open that contact instead of adding a second one.';
}

export async function findContactByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string
): Promise<PhoneOwner | null> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return null;
  const { data, error } = await db
    .from('contacts')
    .select('id, name, second_name, phone')
    .eq('account_id', accountId)
    .eq('is_merged', false)
    .in('phone', variants)
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) throw error;
  return pickPhoneOwner(phone, (data ?? []) as PhoneOwner[]);
}
