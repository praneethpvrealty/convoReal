import type { SupabaseClient } from '@supabase/supabase-js';

import { phoneMatchKey } from './phone-key';

export const DUPLICATE_PHONE = 'DUPLICATE_PHONE';

export interface PhoneOwner {
  id: string | null;
  visible: boolean;
  name: string | null;
  second_name: string | null;
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
  const key = phoneMatchKey(phone);
  if (!key) return null;

  const { data: visible, error: visibleError } = await db.rpc(
    'visible_contact_with_phone_key',
    { p_account_id: accountId, p_key: key }
  );
  if (visibleError) throw visibleError;
  const row = (
    (visible ?? []) as {
      id: string;
      name: string | null;
      second_name: string | null;
    }[]
  )[0];
  if (row) {
    return {
      id: row.id,
      visible: true,
      name: row.name,
      second_name: row.second_name,
    };
  }

  const { data: taken, error: takenError } = await db.rpc(
    'account_has_phone_key',
    { p_account_id: accountId, p_key: key }
  );
  if (takenError) throw takenError;
  return taken === true
    ? { id: null, visible: false, name: null, second_name: null }
    : null;
}
