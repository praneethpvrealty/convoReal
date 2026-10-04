import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
  TypedSupabaseClient,
} from '@/lib/supabase/database';
import type { Contact } from '@/types';

type DB = TypedSupabaseClient;

export interface PhoneVariants {
  rawPhone: string | null | undefined;
  normalized: string;
  cleanPhone: string;
}

export type ContactIdName = Pick<Tables<'contacts'>, 'id' | 'name'>;

export type ContactIdNamePhone = Pick<
  Tables<'contacts'>,
  'id' | 'name' | 'phone'
>;

export type ContactIdNameClassification = Pick<
  Tables<'contacts'>,
  'id' | 'name' | 'classification'
>;

export type ContactEnrichmentFields = Pick<
  Tables<'contacts'>,
  'email' | 'company' | 'name_tag' | 'requirements'
>;

export type ContactEnrichmentPatch = Partial<
  Pick<
    TablesUpdate<'contacts'>,
    'email' | 'company' | 'name_tag' | 'requirements'
  >
>;

export type ContactInsert = TablesInsert<'contacts'>;
export type TagInsert = TablesInsert<'tags'>;
export type ContactTagInsert = TablesInsert<'contact_tags'>;
export type ContactNoteInsert = TablesInsert<'contact_notes'>;

export interface RepoResult<T> {
  data: T;
  error: PostgrestError | null;
}

function escapeQuoted(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

function phoneVariantsFilter(phones: PhoneVariants): string {
  return `phone.eq."${escapeQuoted(String(phones.rawPhone))}",phone.eq.${phones.normalized},phone.eq.${phones.cleanPhone}`;
}

export async function findContactByPhoneVariants(
  db: DB,
  accountId: string,
  phones: PhoneVariants
): Promise<RepoResult<ContactIdName | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name')
    .eq('account_id', accountId)
    .or(phoneVariantsFilter(phones))
    .maybeSingle();
  return { data, error };
}

export async function findContactByName(
  db: DB,
  accountId: string,
  name: string
): Promise<RepoResult<ContactIdName | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name')
    .eq('account_id', accountId)
    .ilike('name', name)
    .maybeSingle();
  return { data, error };
}

export async function listContactsByPhoneVariants(
  db: DB,
  accountId: string,
  phones: PhoneVariants
): Promise<RepoResult<ContactIdNameClassification[] | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name, classification')
    .eq('account_id', accountId)
    .or(phoneVariantsFilter(phones));
  return { data, error };
}

export async function listUnmergedContactsForLinking(
  db: DB,
  accountId: string
): Promise<RepoResult<ContactIdNamePhone[] | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('account_id', accountId)
    .eq('is_merged', false);
  return { data, error };
}

export async function findContactNameById(
  db: DB,
  accountId: string,
  contactId: string
): Promise<RepoResult<Pick<Tables<'contacts'>, 'name'> | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  return { data, error };
}

export async function findContactIdentityById(
  db: DB,
  accountId: string,
  contactId: string
): Promise<RepoResult<ContactIdNamePhone | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  return { data, error };
}

export async function findContactEnrichmentFields(
  db: DB,
  accountId: string,
  contactId: string
): Promise<RepoResult<ContactEnrichmentFields | null>> {
  const { data, error } = await db
    .from('contacts')
    .select('email, company, name_tag, requirements')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  return { data, error };
}

export async function updateContactEnrichment(
  db: DB,
  accountId: string,
  contactId: string,
  patch: ContactEnrichmentPatch
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('account_id', accountId);
  return { error };
}

export async function findReferrerContacts(
  db: DB,
  accountId: string,
  referrerName: string,
  referrerPhones: PhoneVariants | null
): Promise<RepoResult<ContactIdName[] | null>> {
  const query = db
    .from('contacts')
    .select('id, name')
    .eq('account_id', accountId);
  const { data, error } = referrerPhones
    ? await query.or(
        `phone.eq."${escapeQuoted(String(referrerPhones.rawPhone))}",phone.eq.${referrerPhones.normalized},phone.eq.${referrerPhones.cleanPhone},name.ilike."${escapeQuoted(referrerName)}"`
      )
    : await query.ilike('name', referrerName);
  return { data, error };
}

export async function insertContact(
  db: DB,
  row: ContactInsert
): Promise<RepoResult<Tables<'contacts'> | null>> {
  const { data, error } = await db
    .from('contacts')
    .insert(row)
    .select()
    .single();
  return { data, error };
}

export async function insertContacts(
  db: DB,
  rows: ContactInsert[]
): Promise<RepoResult<Contact[]>> {
  const { data, error } = await db.from('contacts').insert(rows).select();
  return { data: (data ?? []) as Contact[], error };
}

export async function listTagIdNames(
  db: DB,
  accountId: string
): Promise<RepoResult<Pick<Tables<'tags'>, 'id' | 'name'>[] | null>> {
  const { data, error } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId);
  return { data, error };
}

export async function insertTag(
  db: DB,
  row: TagInsert
): Promise<RepoResult<Tables<'tags'> | null>> {
  const { data, error } = await db.from('tags').insert(row).select().single();
  return { data, error };
}

export async function insertContactTags(
  db: DB,
  rows: ContactTagInsert[]
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from('contact_tags').insert(rows);
  return { error };
}

export async function insertContactNotes(
  db: DB,
  rows: ContactNoteInsert[]
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from('contact_notes').insert(rows);
  return { error };
}
