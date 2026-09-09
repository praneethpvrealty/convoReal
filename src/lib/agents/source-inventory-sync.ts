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

interface SharedPropertyRow {
  property_id: string;
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
  const [sourceContactsResult, sharedPropertiesResult] = await Promise.all([
    admin.rpc('find_agent_source_contacts', {
      p_phone_last10: input.phoneLast10,
    }),
    admin.rpc('find_property_shares_for_phone', {
      p_phone_last10: input.phoneLast10,
    }),
  ]);
  const { data: sourceContacts, error: contactsError } = sourceContactsResult;
  if (contactsError) throw contactsError;
  if (sharedPropertiesResult.error) throw sharedPropertiesResult.error;

  const contacts = ((sourceContacts ?? []) as SourceContactRow[])
    .filter((row) => row.account_id !== input.accountId)
    .slice(0, MAX_SOURCE_CONTACTS);
  const sharedProperties = (
    (sharedPropertiesResult.data ?? []) as SharedPropertyRow[]
  )
    .filter(
      (row) =>
        typeof row.property_id === 'string' &&
        typeof row.account_id === 'string' &&
        row.account_id !== input.accountId
    )
    .slice(0, MAX_SOURCE_PROPERTIES);
  if (contacts.length === 0 && sharedProperties.length === 0) {
    return { imported: 0, matched: 0 };
  }

  const sourceAccountByContact = new Map(
    contacts.map((row) => [row.contact_id, row.account_id])
  );
  const sharedPropertyIds = sharedProperties.map((row) => row.property_id);
  const [sourceResult, sharedResult] = await Promise.all([
    contacts.length > 0
      ? admin
          .from('properties')
          .select(`${SHARED_PROPERTY_COLUMNS}, owner_contact_id`)
          .in('owner_contact_id', [...sourceAccountByContact.keys()])
          .eq('listing_source', 'agent')
          .is('source_property_id', null)
          .limit(MAX_SOURCE_PROPERTIES)
      : Promise.resolve({ data: [], error: null }),
    sharedPropertyIds.length > 0
      ? admin
          .from('properties')
          .select(SHARED_PROPERTY_COLUMNS)
          .in('id', sharedPropertyIds)
          .eq('is_published', true)
          .limit(MAX_SOURCE_PROPERTIES)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceResult.error) throw sourceResult.error;
  if (sharedResult.error) throw sharedResult.error;

  const attributedSources = (
    (sourceResult.data ?? []) as unknown as Record<string, unknown>[]
  ).filter(
    (row) =>
      typeof row.id === 'string' &&
      typeof row.owner_contact_id === 'string' &&
      sourceAccountByContact.get(row.owner_contact_id) === row.account_id
  );
  const sharedSourceAccountById = new Map(
    sharedProperties.map((row) => [row.property_id, row.account_id])
  );
  const explicitlySharedSources = (
    (sharedResult.data ?? []) as unknown as Record<string, unknown>[]
  ).filter(
    (row) =>
      typeof row.id === 'string' &&
      sharedSourceAccountById.get(row.id) === row.account_id
  );
  const sourcesById = new Map<
    string,
    { source: Record<string, unknown>; pendingReview: boolean }
  >();
  for (const source of attributedSources) {
    sourcesById.set(source.id as string, { source, pendingReview: false });
  }
  for (const source of explicitlySharedSources) {
    sourcesById.set(source.id as string, { source, pendingReview: true });
  }
  const sources = [...sourcesById.values()];
  if (sources.length === 0) return { imported: 0, matched: 0 };

  const sourceIds = sources.map(({ source }) => source.id as string);
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
    .filter(({ source }) => !existingIds.has(source.id as string))
    .map(({ source, pendingReview }) =>
      buildSharedPropertyCopy(source, {
        accountId: input.accountId,
        userId: input.userId,
        ownerContactId: null,
        status: pendingReview ? 'Pending Review' : 'Available',
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
