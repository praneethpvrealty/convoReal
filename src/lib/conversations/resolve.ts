import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * The one way to get at a contact's 1:1 thread.
 *
 * Every caller used to hand-roll read-then-insert, and none of them
 * were safe: concurrent senders both read empty and both inserted, and
 * once two rows existed the reads (`.single()` / `.maybeSingle()` with
 * no `.limit(1)`) failed with PGRST116 and were mistaken for "none
 * found", so each further message opened another thread. Migration 227
 * folded the wreckage together and added
 * `conversations_account_contact_unique`; this resolves against it.
 *
 * Ordering by `created_at` rather than recency is deliberate — the
 * oldest row is the one migration 229 kept and the one existing deals,
 * flow runs and reply bridges point at.
 */

/** Postgres unique_violation — the race we expect to lose sometimes. */
const UNIQUE_VIOLATION = '23505';

/** The columns callers read off a resolved thread. */
export interface ConversationRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  user_id: string;
  status: string;
  unread_count: number | null;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  is_archived: boolean;
}

export interface ResolveConversationArgs {
  accountId: string;
  contactId: string;
  /**
   * Owner of the row when this call is the one that creates it. Nullable
   * only so callers can forward an unresolved owner and get the NOT NULL
   * violation back as an error, the way they did before this helper.
   */
  userId: string | null;
  /** Columns seeded on creation only; never applied to an existing row. */
  onCreate?: Record<string, unknown>;
  /** Column list to read back. */
  columns?: string;
}

export interface ResolveConversationResult<Row> {
  conversation: Row | null;
  /** True when this call inserted the row, for callers that seed state. */
  created: boolean;
  error?: PostgrestError | null;
}

export async function resolveConversation<Row = Record<string, unknown>>(
  db: SupabaseClient,
  {
    accountId,
    contactId,
    userId,
    onCreate,
    columns = '*',
  }: ResolveConversationArgs
): Promise<ResolveConversationResult<Row>> {
  const read = async () => {
    const { data, error } = await db
      .from('conversations')
      .select(columns)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return { data: data as Row | null, error };
  };

  const found = await read();
  if (found.data) return { conversation: found.data, created: false };

  const { data: inserted, error: insertError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      ...onCreate,
    })
    .select(columns)
    .single();

  if (!insertError && inserted) {
    return { conversation: inserted as Row, created: true };
  }

  // Lost the insert race: the winner's row is the answer, not an error.
  if (insertError?.code === UNIQUE_VIOLATION) {
    const retry = await read();
    if (retry.data) return { conversation: retry.data, created: false };
    return {
      conversation: null,
      created: false,
      error: retry.error ?? insertError,
    };
  }

  return { conversation: null, created: false, error: insertError };
}

/** `resolveConversation` for callers that only need the id. */
export async function resolveConversationId(
  db: SupabaseClient,
  args: ResolveConversationArgs
): Promise<string | null> {
  const { conversation } = await resolveConversation<{ id: string }>(db, {
    ...args,
    columns: 'id',
  });
  return conversation?.id ?? null;
}

/**
 * The contact's thread without creating one. Used by callers that have
 * nothing to write yet and must not leave an empty thread behind.
 */
export async function findConversation<Row = Record<string, unknown>>(
  db: SupabaseClient,
  {
    accountId,
    contactId,
    columns = '*',
  }: Omit<ResolveConversationArgs, 'userId' | 'onCreate'>
): Promise<Row | null> {
  const { data } = await db
    .from('conversations')
    .select(columns)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}
