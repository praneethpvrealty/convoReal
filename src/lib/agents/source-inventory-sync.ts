import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  buildSharedPropertyCopy,
  SHARED_PROPERTY_COLUMNS,
} from '@/lib/inventory/shared-property-copy';

const MAX_SOURCE_CONTACTS = 50;
const MAX_SOURCE_PROPERTIES = 100;

interface SourceInventoryContext {
  accountId: string;
  userId: string;
  supabase: SupabaseClient;
}

interface SourceContactRow {
  contact_id: string;
  account_id: string;
}

export interface SourceInventorySyncResult {
  imported: number;
  matched: number;
}

export async function syncAgentSourceInventory(
  ctx: SourceInventoryContext
): Promise<SourceInventorySyncResult> {
  const { data: profile, error: profileError } = await ctx.supabase
    .from('profiles')
    .select('phone')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const phoneLast10 = normalizePhone(profile?.phone).slice(-10);
  if (!phoneLast10) return { imported: 0, matched: 0 };

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  return syncAgentSourceInventoryWithAdmin(admin, {
    accountId: ctx.accountId,
    userId: ctx.userId,
    phoneLast10,
  });
}

export async function syncAgentSourceInventoryWithAdmin(
  admin: SupabaseClient,
  input: { accountId: string; userId: string; phoneLast10: string }
): Promise<SourceInventorySyncResult> {
  const { data: sourceContacts, error: contactsError } = await admin.rpc(
    'find_agent_source_contacts',
    { p_phone_last10: input.phoneLast10 }
  );
  if (contactsError) throw contactsError;

  const contacts = ((sourceContacts ?? []) as SourceContactRow[])
    .filter((row) => row.account_id !== input.accountId)
    .slice(0, MAX_SOURCE_CONTACTS);
  if (contacts.length === 0) return { imported: 0, matched: 0 };

  const sourceAccountByContact = new Map(
    contacts.map((row) => [row.contact_id, row.account_id])
  );
  const { data: sourceRows, error: sourceError } = await admin
    .from('properties')
    .select(`${SHARED_PROPERTY_COLUMNS}, owner_contact_id`)
    .in('owner_contact_id', [...sourceAccountByContact.keys()])
    .eq('listing_source', 'agent')
    .is('source_property_id', null)
    .limit(MAX_SOURCE_PROPERTIES);
  if (sourceError) throw sourceError;

  const sources = (
    (sourceRows ?? []) as unknown as Record<string, unknown>[]
  ).filter(
    (row) =>
      typeof row.id === 'string' &&
      typeof row.owner_contact_id === 'string' &&
      sourceAccountByContact.get(row.owner_contact_id) === row.account_id
  );
  if (sources.length === 0) return { imported: 0, matched: 0 };

  const sourceIds = sources.map((row) => row.id as string);
  const { data: existingRows, error: existingError } = await admin
    .from('properties')
    .select('source_property_id')
    .eq('account_id', input.accountId)
    .in('source_property_id', sourceIds);
  if (existingError) throw existingError;

  const existingIds = new Set(
    (existingRows ?? [])
      .map((row) => row.source_property_id as string | null)
      .filter((id): id is string => Boolean(id))
  );
  const inserts = sources
    .filter((source) => !existingIds.has(source.id as string))
    .map((source) =>
      buildSharedPropertyCopy(source, {
        accountId: input.accountId,
        userId: input.userId,
        ownerContactId: null,
      })
    );
  if (inserts.length === 0) {
    return { imported: 0, matched: sources.length };
  }

  const { data: importedRows, error: insertError } = await admin
    .from('properties')
    .upsert(inserts, {
      onConflict: 'account_id,source_property_id',
      ignoreDuplicates: true,
    })
    .select('id');
  if (insertError) throw insertError;

  return {
    imported: importedRows?.length ?? 0,
    matched: sources.length,
  };
}
