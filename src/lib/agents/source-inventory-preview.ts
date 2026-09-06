import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/whatsapp/phone-utils';

const MAX_SOURCE_CONTACTS = 50;
const MAX_SOURCE_PROPERTIES = 100;
const MAX_CONSULTANT_NAMES = 3;

interface SourceContactRow {
  contact_id: string;
  account_id: string;
}

interface SourcePropertyRow {
  id: string;
  account_id: string;
  owner_contact_id: string;
}

export interface SourceInventoryPreview {
  propertyCount: number;
  consultantNames: string[];
}

export const EMPTY_SOURCE_INVENTORY_PREVIEW: SourceInventoryPreview = {
  propertyCount: 0,
  consultantNames: [],
};

export async function readSourceInventoryPreview(
  admin: SupabaseClient,
  phone: string | null | undefined
): Promise<SourceInventoryPreview> {
  const phoneLast10 = normalizePhone(phone).slice(-10);
  if (!phoneLast10) return EMPTY_SOURCE_INVENTORY_PREVIEW;

  const { data: sourceContacts, error: contactsError } = await admin.rpc(
    'find_agent_source_contacts',
    { p_phone_last10: phoneLast10 }
  );
  if (contactsError) throw contactsError;

  const contacts = ((sourceContacts ?? []) as SourceContactRow[]).slice(
    0,
    MAX_SOURCE_CONTACTS
  );
  if (contacts.length === 0) return EMPTY_SOURCE_INVENTORY_PREVIEW;

  const sourceAccountByContact = new Map(
    contacts.map((row) => [row.contact_id, row.account_id])
  );
  const { data: propertyRows, error: propertiesError } = await admin
    .from('properties')
    .select('id, account_id, owner_contact_id')
    .in('owner_contact_id', [...sourceAccountByContact.keys()])
    .eq('listing_source', 'agent')
    .is('source_property_id', null)
    .limit(MAX_SOURCE_PROPERTIES);
  if (propertiesError) throw propertiesError;

  const properties = ((propertyRows ?? []) as SourcePropertyRow[]).filter(
    (row) => sourceAccountByContact.get(row.owner_contact_id) === row.account_id
  );
  if (properties.length === 0) return EMPTY_SOURCE_INVENTORY_PREVIEW;

  const propertyCountByAccount = new Map<string, number>();
  for (const property of properties) {
    propertyCountByAccount.set(
      property.account_id,
      (propertyCountByAccount.get(property.account_id) ?? 0) + 1
    );
  }

  const { data: accountRows, error: accountsError } = await admin
    .from('accounts')
    .select('id, name')
    .in('id', [...propertyCountByAccount.keys()]);
  if (accountsError) throw accountsError;

  const consultantNames = (accountRows ?? [])
    .filter(
      (row): row is { id: string; name: string } =>
        typeof row.id === 'string' &&
        typeof row.name === 'string' &&
        row.name.trim().length > 0
    )
    .sort(
      (left, right) =>
        (propertyCountByAccount.get(right.id) ?? 0) -
          (propertyCountByAccount.get(left.id) ?? 0) ||
        left.name.localeCompare(right.name)
    )
    .slice(0, MAX_CONSULTANT_NAMES)
    .map((row) => row.name.trim());

  return { propertyCount: properties.length, consultantNames };
}

export async function safeSourceInventoryPreview(
  admin: SupabaseClient,
  phone: string | null | undefined
): Promise<SourceInventoryPreview> {
  try {
    return await readSourceInventoryPreview(admin, phone);
  } catch (error) {
    console.error('[source-inventory-preview] Lookup failed:', error);
    return EMPTY_SOURCE_INVENTORY_PREVIEW;
  }
}
