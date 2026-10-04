import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Json,
  Tables,
  TypedSupabaseClient,
} from '@/lib/supabase/database';
import type {
  ParsedContactDraftsContainer,
  ParsedPropertyDraft,
} from '@/lib/ai/gemini';

type DB = TypedSupabaseClient;

// How long a draft stays answerable after the last message on it. The
// confirmation card is often read long after it lands, so Confirm,
// Cancel and plain-language corrections all keep working for an hour
// before the draft is discarded.
export const DRAFT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

export const DRAFT_MUTATION_MAX_ATTEMPTS = 5;

// Cards forwarded back to back are one batch. A card that had to wait
// for the conversation lease joins a draft written this recently; past
// it the draft is old business and a different person replaces it.
export const CONTACT_CARD_BURST_WINDOW_MS = 60 * 1000;

export type DraftSessionStatus = 'collecting' | 'awaiting_confirmation';

export type PropertyDraftSessionMode = 'owner' | 'external';

export type PropertyDraftSessionRow = Omit<
  Tables<'property_draft_sessions'>,
  'draft_data' | 'status' | 'session_mode'
> & {
  draft_data: ParsedPropertyDraft;
  status: DraftSessionStatus;
  session_mode: PropertyDraftSessionMode;
};

export type ContactDraftSessionRow = Omit<
  Tables<'contact_draft_sessions'>,
  'draft_data' | 'status'
> & {
  draft_data: ParsedContactDraftsContainer;
  status: DraftSessionStatus;
};

export type PropertyDraftSessionInsert = Pick<
  PropertyDraftSessionRow,
  'account_id' | 'contact_id' | 'draft_data' | 'status'
> &
  Partial<
    Pick<PropertyDraftSessionRow, 'session_mode' | 'requirement_link_id'>
  >;

export type ContactDraftSessionInsert = Pick<
  ContactDraftSessionRow,
  'account_id' | 'contact_id' | 'draft_data' | 'status'
>;

export interface SingleResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export interface NextPropertyDraft {
  draft_data: ParsedPropertyDraft;
  status: DraftSessionStatus;
}

export interface NextContactDraft {
  draft_data: ParsedContactDraftsContainer;
  status: DraftSessionStatus;
}

export type MutateDraftResult<Row, Next> =
  | { status: 'ok'; row: Row; next: Next }
  | { status: 'gone' }
  | { status: 'error'; error: PostgrestError | null }
  | { status: 'conflict' }
  | { status: 'skipped' };

export type MutatePropertyDraftResult = MutateDraftResult<
  PropertyDraftSessionRow,
  NextPropertyDraft
>;

export type MutateContactDraftResult = MutateDraftResult<
  ContactDraftSessionRow,
  NextContactDraft
>;

export interface MutatePropertyDraftOptions {
  onMissingRow?: 'report' | 'retry';
}

export async function findPropertyDraftSession(
  db: DB,
  contactId: string,
  mode?: PropertyDraftSessionMode
): Promise<SingleResult<PropertyDraftSessionRow>> {
  let query = db
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contactId);
  if (mode) query = query.eq('session_mode', mode);
  const { data, error } = await query.maybeSingle();
  return { data: data as PropertyDraftSessionRow | null, error };
}

export async function findPropertyDraftSessionById(
  db: DB,
  id: string
): Promise<SingleResult<PropertyDraftSessionRow>> {
  const { data, error } = await db
    .from('property_draft_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return { data: data as PropertyDraftSessionRow | null, error };
}

export async function findContactDraftSession(
  db: DB,
  contactId: string,
  accountId?: string
): Promise<SingleResult<ContactDraftSessionRow>> {
  let query = db
    .from('contact_draft_sessions')
    .select('*')
    .eq('contact_id', contactId);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query.maybeSingle();
  return { data: data as ContactDraftSessionRow | null, error };
}

export async function deletePropertyDraftSession(
  db: DB,
  id: string
): Promise<void> {
  await db.from('property_draft_sessions').delete().eq('id', id);
}

export async function deleteContactDraftSession(
  db: DB,
  id: string
): Promise<void> {
  await db.from('contact_draft_sessions').delete().eq('id', id);
}

export async function touchPropertyDraftSession(
  db: DB,
  id: string
): Promise<void> {
  await db
    .from('property_draft_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function insertPropertyDraftSession(
  db: DB,
  row: PropertyDraftSessionInsert
): Promise<{
  data: PropertyDraftSessionRow[] | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await db
    .from('property_draft_sessions')
    .insert(row)
    .select();
  return { data: data as PropertyDraftSessionRow[] | null, error };
}

export async function insertContactDraftSession(
  db: DB,
  row: ContactDraftSessionInsert
): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from('contact_draft_sessions').insert(row);
  return { error };
}

export async function overwriteContactDraftSession(
  db: DB,
  id: string,
  draftData: ParsedContactDraftsContainer,
  status: DraftSessionStatus
): Promise<string | null> {
  const { data } = await db
    .from('contact_draft_sessions')
    .update({
      draft_data: draftData,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('updated_at')
    .maybeSingle();
  return data?.updated_at ?? null;
}

async function mutateDraftRow<
  Row extends { updated_at: string },
  Next extends { draft_data: Json; status: DraftSessionStatus },
>(
  db: DB,
  table: 'property_draft_sessions' | 'contact_draft_sessions',
  id: string,
  next: (row: Row) => Promise<Next | null> | Next | null,
  onMissingRow: 'report' | 'retry',
  accountId?: string
): Promise<MutateDraftResult<Row, Next>> {
  let attempts = 0;

  while (attempts < DRAFT_MUTATION_MAX_ATTEMPTS) {
    let read = db.from(table).select('*').eq('id', id);
    if (accountId) read = read.eq('account_id', accountId);
    const { data, error: fetchErr } = await read.single();
    const latest = data as Row | null;

    if (onMissingRow === 'retry') {
      if (!latest) {
        attempts++;
        continue;
      }
    } else if (fetchErr || !latest) {
      if (fetchErr?.code === 'PGRST116') return { status: 'gone' };
      return { status: 'error', error: fetchErr };
    }

    const nextDraft = await next(latest);
    if (!nextDraft) return { status: 'skipped' };

    let write = db
      .from(table)
      .update({
        draft_data: nextDraft.draft_data,
        status: nextDraft.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('updated_at', latest.updated_at);
    if (accountId) write = write.eq('account_id', accountId);
    const { data: updateData, error: updateErr } = await write.select();
    const written = updateData as Row[] | null;

    if (!updateErr && written && written.length > 0) {
      return { status: 'ok', row: written[0], next: nextDraft };
    }
    attempts++;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 200 + 50)
    );
  }

  return { status: 'conflict' };
}

export function mutatePropertyDraft(
  db: DB,
  id: string,
  next: (
    row: PropertyDraftSessionRow
  ) => Promise<NextPropertyDraft | null> | NextPropertyDraft | null,
  options: MutatePropertyDraftOptions = {}
): Promise<MutatePropertyDraftResult> {
  return mutateDraftRow<PropertyDraftSessionRow, NextPropertyDraft>(
    db,
    'property_draft_sessions',
    id,
    next,
    options.onMissingRow ?? 'report'
  );
}

export function mutateContactDraft(
  db: DB,
  id: string,
  next: (
    row: ContactDraftSessionRow
  ) => Promise<NextContactDraft | null> | NextContactDraft | null,
  accountId?: string
): Promise<MutateContactDraftResult> {
  return mutateDraftRow<ContactDraftSessionRow, NextContactDraft>(
    db,
    'contact_draft_sessions',
    id,
    next,
    'report',
    accountId
  );
}

export function isDraftSessionExpired(
  row: Pick<PropertyDraftSessionRow | ContactDraftSessionRow, 'updated_at'>,
  now: number
): boolean {
  return now - new Date(row.updated_at).getTime() > DRAFT_SESSION_TIMEOUT_MS;
}

export function isContactCardBurst(
  row: Pick<ContactDraftSessionRow, 'updated_at'>,
  waited: boolean,
  now: number
): boolean {
  return (
    waited &&
    now - new Date(row.updated_at).getTime() <= CONTACT_CARD_BURST_WINDOW_MS
  );
}

/**
 * Whether a quote-reply points at something the bot said about this
 * draft: a bot message of the same conversation, sent since the draft
 * was opened.
 */
export async function isReplyToContactDraft(
  db: DB,
  conversationId: string,
  contextId: string | null | undefined,
  row: Pick<ContactDraftSessionRow, 'created_at'>
): Promise<boolean> {
  if (!contextId || !row.created_at) return false;
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('message_id', contextId)
    .eq('sender_type', 'bot')
    .maybeSingle();
  if (error || !data?.created_at) return false;
  return (
    new Date(data.created_at).getTime() >= new Date(row.created_at).getTime()
  );
}
