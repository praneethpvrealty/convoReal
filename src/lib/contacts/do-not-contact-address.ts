import type { SupabaseClient } from '@supabase/supabase-js';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';

/**
 * Whether an address a send is about to go to belongs to a contact
 * marked Do not contact. For the paths that deliver to a typed number
 * or email rather than through the dispatcher's contact resolution
 * (invoices today). Every matching row counts, merged aliases included,
 * so a blocked duplicate cannot be reached through its number.
 *
 * Returns null when the lookup fails, so callers refuse rather than send.
 */
export async function addressIsDoNotContact(
  db: SupabaseClient,
  accountId: string,
  address: { phone?: string | null; email?: string | null }
): Promise<boolean | null> {
  const phone = address.phone?.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 0) {
      const suffix = digits.length >= 8 ? digits.slice(-8) : digits;
      const { data, error } = await db
        .from('contacts')
        .select('phone, do_not_contact')
        .eq('account_id', accountId)
        .eq('do_not_contact', true)
        .like('phone', `%${suffix}`);
      if (error) return null;
      if (
        (data ?? []).some(
          (row: { phone: string | null }) =>
            !!row.phone && phonesMatch(row.phone, phone)
        )
      ) {
        return true;
      }
    }
  }

  const email = address.email?.trim();
  if (email) {
    const { data, error } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('do_not_contact', true)
      .ilike('email', email.replace(/[%_\\]/g, '\\$&'))
      .limit(1);
    if (error) return null;
    if ((data ?? []).length > 0) return true;
  }

  return false;
}
