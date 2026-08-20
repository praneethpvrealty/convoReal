// ============================================================
// Yesterday, gathered.
//
// Two stores, one shape. The client inbox is `messages` joined to
// `conversations`; the account holder's own WhatsApp is
// `journey_events` with metadata.channel = 'personal_whatsapp' and is
// outbound-only, because that is all we can see of a number we do not
// own. Both come out as SweepThread so nothing downstream branches on
// where a line came from.
//
// Everything is batched per account. The alternative — a query per
// thread for "does this contact have a deal?" — is four round trips
// times the number of active conversations, every morning, for every
// account, which is the shape §2.6 exists to keep out of this
// codebase.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { CLOSED_LISTING_STATUS_FILTER } from '@/lib/inventory/listing-status';
import type { SweepThread, ThreadContext } from './types';

/**
 * Threads read per account per morning, newest activity first.
 *
 * A cap and not a page: this is a digest, and an account with 400
 * active threads does not want 400 lines any more than it wants the
 * bill for reading them. The busiest threads are the ones worth the
 * model call.
 */
export const MAX_THREADS_PER_ACCOUNT = 60;

/** Messages carried per thread. Past this the transcript budget in
 *  transcript.ts is doing the trimming anyway. */
const MAX_MESSAGES_PER_THREAD = 120;

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'bot';
  content_type: string;
  content_text: string | null;
  created_at: string;
}

interface ConversationRow {
  id: string;
  contact_id: string | null;
  assigned_agent_id: string | null;
  contacts: { id: string; name: string | null } | null;
}

interface JourneyEventRow {
  id: string;
  item_id: string;
  created_at: string;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
}

function nameOf(row: ConversationRow): string | null {
  return row.contacts?.name ?? null;
}

/**
 * Client-inbox threads with activity in the window.
 *
 * The window selects which THREADS to read, but each selected thread
 * is then read a little wider — a promise made on Monday is only a
 * gap because of what did not happen since, and a strictly-windowed
 * transcript would start after the promise and see only silence.
 */
export async function collectClientThreads(
  db: SupabaseClient,
  accountId: string,
  window: { start: Date; end: Date }
): Promise<SweepThread[]> {
  const { data: active, error: activeErr } = await db
    .from('messages')
    .select('conversation_id, created_at')
    .eq('account_id', accountId)
    .gte('created_at', window.start.toISOString())
    .lt('created_at', window.end.toISOString())
    .order('created_at', { ascending: false })
    .limit(2000);

  if (activeErr) {
    console.error('[sweep] active thread scan failed:', activeErr);
    return [];
  }

  const conversationIds: string[] = [];
  const seen = new Set<string>();
  for (const row of (active as { conversation_id: string }[] | null) ?? []) {
    if (!row.conversation_id || seen.has(row.conversation_id)) continue;
    seen.add(row.conversation_id);
    conversationIds.push(row.conversation_id);
    if (conversationIds.length >= MAX_THREADS_PER_ACCOUNT) break;
  }
  if (!conversationIds.length) return [];

  const [{ data: conversations }, { data: messages }] = await Promise.all([
    db
      .from('conversations')
      .select('id, contact_id, assigned_agent_id, contacts(id, name)')
      .eq('account_id', accountId)
      .in('id', conversationIds),
    db
      .from('messages')
      .select(
        'id, conversation_id, sender_type, content_type, content_text, created_at'
      )
      // Read back beyond the window so a promise and its silence are
      // in the same transcript. Seven days is a working week — long
      // enough for "by the weekend", short enough to stay cheap.
      .gte(
        'created_at',
        new Date(window.end.getTime() - 7 * 86_400_000).toISOString()
      )
      .lt('created_at', window.end.toISOString())
      .eq('account_id', accountId)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true })
      .limit(MAX_THREADS_PER_ACCOUNT * MAX_MESSAGES_PER_THREAD),
  ]);

  const byConversation = new Map<string, MessageRow[]>();
  for (const row of (messages as MessageRow[] | null) ?? []) {
    const list = byConversation.get(row.conversation_id) ?? [];
    list.push(row);
    byConversation.set(row.conversation_id, list);
  }

  return ((conversations as ConversationRow[] | null) ?? [])
    .map((conversation) => {
      const rows = (byConversation.get(conversation.id) ?? []).slice(
        -MAX_MESSAGES_PER_THREAD
      );
      return {
        accountId,
        channel: 'client' as const,
        contactId: conversation.contact_id,
        contactName: nameOf(conversation),
        conversationId: conversation.id,
        assignedAgentId: conversation.assigned_agent_id,
        propertyId: null,
        messages: rows.map((row) => ({
          id: row.id,
          speaker: row.sender_type,
          text: row.content_text ?? '',
          contentType: row.content_type,
          createdAt: row.created_at,
        })),
      };
    })
    .filter((thread) => thread.messages.length > 0);
}

/**
 * The account holder's own WhatsApp, as far as we can see it.
 *
 * Outbound only, and honestly so: these are sends the Engine
 * dispatched on the account holder's behalf, not a mirror of their
 * personal inbox. A gap kind that needs an inbound line —
 * unanswered_question — is refused for this channel in detectors.ts
 * rather than being silently wrong here.
 */
export async function collectPersonalThreads(
  db: SupabaseClient,
  accountId: string,
  window: { start: Date; end: Date }
): Promise<SweepThread[]> {
  const { data, error } = await db
    .from('journey_events')
    .select('id, item_id, created_at, created_by, metadata')
    .eq('account_id', accountId)
    .eq('event_type', 'outbound_whatsapp')
    .contains('metadata', { channel: 'personal_whatsapp' })
    .gte('created_at', window.start.toISOString())
    .lt('created_at', window.end.toISOString())
    .order('created_at', { ascending: true })
    .limit(MAX_THREADS_PER_ACCOUNT * 20);

  if (error) {
    console.error('[sweep] personal WhatsApp scan failed:', error);
    return [];
  }

  const byContact = new Map<string, SweepThread>();
  for (const row of (data as JourneyEventRow[] | null) ?? []) {
    const meta = row.metadata ?? {};
    const contactId =
      typeof meta.contact_id === 'string' ? meta.contact_id : null;
    const message = typeof meta.message === 'string' ? meta.message : '';
    if (!contactId || !message.trim()) continue;

    let thread = byContact.get(contactId);
    if (!thread) {
      if (byContact.size >= MAX_THREADS_PER_ACCOUNT) continue;
      thread = {
        accountId,
        channel: 'personal_whatsapp',
        contactId,
        contactName: null,
        conversationId:
          typeof meta.conversation_id === 'string'
            ? meta.conversation_id
            : null,
        assignedAgentId: row.created_by,
        propertyId:
          typeof meta.property_id === 'string' ? meta.property_id : null,
        messages: [],
      };
      byContact.set(contactId, thread);
    }

    thread.messages.push({
      // A journey event is not a `messages` row, and a gap must not
      // carry a foreign key that points nowhere.
      id: null,
      speaker: 'agent',
      text: message,
      contentType: 'text',
      createdAt: row.created_at,
    });
  }

  const threads = [...byContact.values()];
  await attachContactNames(db, accountId, threads);
  return threads;
}

/** Personal-WhatsApp threads come out of journey metadata with no
 *  name on them; the digest is unreadable without one. */
async function attachContactNames(
  db: SupabaseClient,
  accountId: string,
  threads: SweepThread[]
): Promise<void> {
  const ids = [
    ...new Set(threads.map((t) => t.contactId).filter(Boolean)),
  ] as string[];
  if (!ids.length) return;

  const { data } = await db
    .from('contacts')
    .select('id, name')
    .eq('account_id', accountId)
    .in('id', ids);

  const names = new Map(
    ((data as { id: string; name: string | null }[] | null) ?? []).map(
      (row) => [row.id, row.name]
    )
  );
  for (const thread of threads) {
    if (thread.contactId)
      thread.contactName = names.get(thread.contactId) ?? null;
  }
}

interface ContactFacts {
  hasOpenDeal: boolean;
  hasFutureAppointment: boolean;
  hasOpenTodo: boolean;
  hasStatedRequirement: boolean;
  hasSharedAnyProperty: boolean;
}

const NO_FACTS: ContactFacts = {
  hasOpenDeal: false,
  hasFutureAppointment: false,
  hasOpenTodo: false,
  hasStatedRequirement: false,
  hasSharedAnyProperty: false,
};

/**
 * Everything the detectors need to know about follow-through, for
 * every contact in one pass.
 *
 * Five queries per account regardless of thread count, each one an
 * id-list membership test. The `.in()` lists are bounded by
 * MAX_THREADS_PER_ACCOUNT, which is what makes them safe to put in a
 * filter at all (§2.6).
 */
export async function collectContexts(
  db: SupabaseClient,
  accountId: string,
  threads: SweepThread[],
  window: { start: Date; end: Date }
): Promise<Map<string, ThreadContext>> {
  const contexts = new Map<string, ThreadContext>();
  const contactIds = [
    ...new Set(threads.map((t) => t.contactId).filter(Boolean)),
  ] as string[];
  const conversationIds = [
    ...new Set(threads.map((t) => t.conversationId).filter(Boolean)),
  ] as string[];

  const facts = new Map<string, ContactFacts>();
  const mark = (id: string | null, key: keyof ContactFacts) => {
    if (!id) return;
    facts.set(id, { ...(facts.get(id) ?? NO_FACTS), [key]: true });
  };

  if (contactIds.length) {
    const nowIso = window.end.toISOString();
    const [deals, appointments, todos, contacts, shares] = await Promise.all([
      db
        .from('deals')
        .select('contact_id')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .in('contact_id', contactIds),
      db
        .from('appointments')
        .select('contact_id')
        .eq('account_id', accountId)
        .eq('status', 'scheduled')
        .gte('start_time', nowIso)
        .in('contact_id', contactIds),
      db
        .from('todos')
        .select('contact_id')
        .eq('account_id', accountId)
        .eq('completed', false)
        .in('contact_id', contactIds),
      db
        .from('contacts')
        .select('id, pref_budget_max, pref_areas, pref_property_types')
        .eq('account_id', accountId)
        .in('id', contactIds),
      db
        .from('property_shares')
        .select('contact_id')
        .eq('account_id', accountId)
        .in('contact_id', contactIds),
    ]);

    for (const row of (deals.data as { contact_id: string }[] | null) ?? [])
      mark(row.contact_id, 'hasOpenDeal');
    for (const row of (appointments.data as { contact_id: string }[] | null) ??
      [])
      mark(row.contact_id, 'hasFutureAppointment');
    for (const row of (todos.data as { contact_id: string }[] | null) ?? [])
      mark(row.contact_id, 'hasOpenTodo');
    for (const row of (shares.data as { contact_id: string }[] | null) ?? [])
      mark(row.contact_id, 'hasSharedAnyProperty');

    type PrefRow = {
      id: string;
      pref_budget_max: number | null;
      pref_areas: string[] | null;
      pref_property_types: string[] | null;
    };
    for (const row of (contacts.data as PrefRow[] | null) ?? []) {
      // "They have told us what they want" — any one of the three is
      // enough to expect a shortlist to exist.
      const stated =
        Boolean(row.pref_budget_max) ||
        Boolean(row.pref_areas?.length) ||
        Boolean(row.pref_property_types?.length);
      if (stated) mark(row.id, 'hasStatedRequirement');
    }
  }

  // Answered after the window closed. Read separately because it is
  // keyed on conversation, not contact, and because it is the one
  // question whose answer lives outside the window entirely.
  const repliedLate = new Set<string>();
  if (conversationIds.length) {
    const { data } = await db
      .from('messages')
      .select('conversation_id')
      .eq('account_id', accountId)
      .in('conversation_id', conversationIds)
      .in('sender_type', ['agent', 'bot'])
      .gte('created_at', window.end.toISOString());
    for (const row of (data as { conversation_id: string }[] | null) ?? [])
      repliedLate.add(row.conversation_id);
  }

  for (const thread of threads) {
    const contactFacts = thread.contactId
      ? (facts.get(thread.contactId) ?? NO_FACTS)
      : NO_FACTS;
    contexts.set(threadKey(thread), {
      ...contactFacts,
      repliedAfterWindow: thread.conversationId
        ? repliedLate.has(thread.conversationId)
        : false,
    });
  }

  return contexts;
}

/** Threads are keyed by conversation where there is one and contact
 *  otherwise — the same subject rule the dedupe key uses. */
export function threadKey(thread: SweepThread): string {
  return `${thread.channel}:${thread.conversationId || thread.contactId || 'unknown'}`;
}

/**
 * Drops the threads belonging to owner-side contacts.
 *
 * Every gap this sweep raises is framed around a BUYER — has anyone
 * shortlisted for them, are they on a pipeline, has a next step been
 * booked. Point that at a seller and the readings invert. On the first
 * production run an owner receiving her own listing's activity digest
 * was raised high-severity as "has told us what they want and has been
 * sent nothing", which is both false and unactionable: she is not
 * waiting for a shortlist, she is waiting for buyers.
 *
 * `properties.owner_contact_id` is the same marker the owner digest
 * routes on, so a contact counted as an owner here is exactly the one
 * that gets owner mail — including agent referrals, which land in the
 * same column (migration 191). Closed listings do not count: once the
 * flat is sold its former owner is an ordinary contact again, and the
 * same CLOSED_LISTING_STATUS_FILTER keeps that consistent with every
 * other scanning sender.
 *
 * The `.in()` list is bounded by MAX_THREADS_PER_ACCOUNT, which is what
 * makes it safe to put in a filter at all (§2.6).
 */
export async function excludeOwnerSideThreads(
  db: SupabaseClient,
  accountId: string,
  threads: SweepThread[]
): Promise<SweepThread[]> {
  const contactIds = [
    ...new Set(threads.map((t) => t.contactId).filter(Boolean)),
  ] as string[];
  if (!contactIds.length) return threads;

  const { data, error } = await db
    .from('properties')
    .select('owner_contact_id')
    .eq('account_id', accountId)
    .in('owner_contact_id', contactIds)
    .not('status', 'in', CLOSED_LISTING_STATUS_FILTER);

  if (error) {
    // Failing open keeps the sweep running on a bad day. The cost is a
    // false owner-side gap, which a reader dismisses; failing closed
    // would silently sweep nothing at all.
    console.error('[sweep] owner-side lookup failed:', error);
    return threads;
  }

  const owners = new Set(
    ((data as { owner_contact_id: string | null }[] | null) ?? [])
      .map((row) => row.owner_contact_id)
      .filter(Boolean) as string[]
  );
  if (!owners.size) return threads;

  return threads.filter((t) => !t.contactId || !owners.has(t.contactId));
}
