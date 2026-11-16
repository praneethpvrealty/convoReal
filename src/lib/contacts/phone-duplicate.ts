import type { SupabaseClient } from '@supabase/supabase-js';

import { phoneMatchKey } from './phone-key';

export const DUPLICATE_PHONE = 'DUPLICATE_PHONE';

export interface PhoneMatch {
  id: string;
  phone: string | null;
  is_merged?: boolean | null;
}

export interface PhoneOwner {
  id: string;
  visible: boolean;
  name: string | null;
  second_name: string | null;
}

export function phoneDigitVariants(phone: string): string[] {
  const key = phoneMatchKey(phone);
  if (!key) return [];
  const digits = phone.replace(/\D/g, '');
  return [...new Set([digits, `00${digits}`, key, `0${key}`, `91${key}`])];
}

export function pickPhoneOwner(
  phone: string,
  candidates: readonly PhoneMatch[]
): PhoneMatch | null {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  return (
    [...candidates]
      .filter((c) => !c.is_merged && phoneMatchKey(c.phone) === key)
      .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
  );
}

export function duplicatePhoneMessage(owner: PhoneOwner): string {
  const fullName = owner.visible
    ? [owner.name, owner.second_name]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    : '';
  if (fullName) {
    return `${fullName} is already saved with this number. Open that contact instead of adding a second one.`;
  }
  return owner.visible
    ? 'A contact with this number is already saved. Open that contact instead of adding a second one.'
    : 'A contact with this number is already saved in your account. Ask an admin to assign it to you instead of adding a second one.';
}

export async function findContactByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string
): Promise<PhoneOwner | null> {
  const digits = phoneDigitVariants(phone);
  if (digits.length === 0) return null;
  const { data, error } = await db.rpc('contacts_matching_phone_digits', {
    p_account_id: accountId,
    p_digits: digits,
  });
  if (error) throw error;
  const match = pickPhoneOwner(phone, (data ?? []) as PhoneMatch[]);
  if (!match) return null;

  const { data: row, error: rowError } = await db
    .from('contacts')
    .select('id, name, second_name')
    .eq('account_id', accountId)
    .eq('id', match.id)
    .maybeSingle();
  if (rowError) throw rowError;
  return {
    id: match.id,
    visible: !!row,
    name: (row?.name as string | null) ?? null,
    second_name: (row?.second_name as string | null) ?? null,
  };
}
