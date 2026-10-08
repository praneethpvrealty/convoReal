// ============================================================
// Which listing is a buyer actually asking about?
//
// property_shares answers this most of the time: the last listing
// formally sent to a contact is the one they are looking at. But an
// agent who types "Have some inventories in Jade Gardens Devanahalli"
// has changed the subject without touching the ledger, and the ledger
// does not even bump — recordPropertyShares upserts with
// ignoreDuplicates, so created_at is the FIRST share, not the latest.
//
// So the buyer asked "Is it by a A grade builder???" about Jade
// Gardens and the bot answered from the Oval Reef plot: "We don't have
// information about the builder's grade in the property details."
// Confidently, fluently, about the wrong property. That is worse than
// silence — a buyer has no way to tell the answer was misaddressed.
//
// This reads the agent's own recent messages for a project the account
// actually holds inventory in. One match moves the subject; several
// (or a project we have nothing in) means we do not know which listing
// is meant, and the caller hands over to a human rather than guessing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_REFERENCED_SUBJECTS } from '@/lib/ai/shortlist-reference';

export interface SubjectCandidate {
  id: string;
  project?: string | null;
  title?: string | null;
}

/**
 * Shortest project name worth matching on. Below this the name carries
 * no signal — an account with a project called "Oak" would claim every
 * message containing the word.
 */
const MIN_PROJECT_NAME = 5;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-token containment, so "Jade Gardens" does not match
 *  "Jadeite Gardenside" and "Oval Reef" does not match "Ovalreefs". */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Ids of every candidate whose project — or, failing that, whose full
 * title — is named in the text.
 *
 * Titles are matched only as a fallback for listings with no project,
 * and only in full: a title is a sentence ("70x60 Residential Plot in
 * Oval Reef, Devanahalli") and matching it loosely would fire on any
 * message mentioning a plot.
 */
export function propertiesNamedIn(
  text: string,
  candidates: SubjectCandidate[]
): string[] {
  const haystack = normalize(text || '');
  if (!haystack) return [];

  const ids = new Set<string>();
  for (const candidate of candidates) {
    const project = normalize(candidate.project || '');
    if (
      project.length >= MIN_PROJECT_NAME &&
      containsPhrase(haystack, project)
    ) {
      ids.add(candidate.id);
      continue;
    }
    if (candidate.project) continue;
    const title = normalize(candidate.title || '');
    if (title.length >= MIN_PROJECT_NAME && containsPhrase(haystack, title)) {
      ids.add(candidate.id);
    }
  }
  return [...ids];
}

export type SubjectVerdict =
  /** Nothing in the thread contradicts the share ledger. */
  | { kind: 'unchanged' }
  /** An agent moved the conversation to exactly one other listing. */
  | { kind: 'moved'; propertyId: string }
  /** The thread names listings we cannot narrow to one. */
  | { kind: 'ambiguous' };

/**
 * Reconciles the share ledger against what an agent has since said.
 *
 * `agentMessages` are the recent outbound messages from a HUMAN, newest
 * first. Bot messages are deliberately excluded: they were already
 * grounded in whatever subject was resolved at the time, so re-reading
 * them adds no information and a shortlist of three listings would
 * make every follow-up look ambiguous.
 */
export function resolveSubjectShift(
  agentMessages: string[],
  candidates: SubjectCandidate[],
  lastSharedPropertyId: string | null
): SubjectVerdict {
  for (const message of agentMessages) {
    const named = propertiesNamedIn(message, candidates);
    if (named.length === 0) continue;

    // The agent was still talking about the listing we sent.
    if (lastSharedPropertyId && named.includes(lastSharedPropertyId)) {
      return { kind: 'unchanged' };
    }
    if (named.length === 1) return { kind: 'moved', propertyId: named[0] };
    // A project with several listings in it — "is it by an A grade
    // builder?" is a fair question about any of them and we cannot tell
    // which, so nobody should be answering it from one row.
    return { kind: 'ambiguous' };
  }
  return { kind: 'unchanged' };
}

/** Agent messages read back when deciding what the subject is. Far
 *  enough to catch a project pitched a few turns ago, short enough that
 *  a listing named yesterday does not outrank today's. */
const SUBJECT_LOOKBACK_MESSAGES = 8;

/** Shares this close together went out as one batch: an agent sending
 *  two cards in a row, a shortlist of three. A question that follows is
 *  about the batch, not about whichever card happened to go last. */
export const SHARE_BURST_MS = 10 * 60 * 1000;

interface RecentShare {
  property_id: string;
  created_at: string;
}

async function recentShares(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<RecentShare[]> {
  const { data } = await db
    .from('property_shares')
    .select('property_id, created_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(MAX_REFERENCED_SUBJECTS + 1);
  return (data ?? []) as RecentShare[];
}

/**
 * The listings shared in the latest batch, newest first, capped at the
 * number one question is answered about. Pure so the batch rule is
 * testable without a database.
 */
export function shareBurst(shares: RecentShare[]): string[] {
  const newest = shares[0];
  if (!newest) return [];
  const since = new Date(newest.created_at).getTime();
  const ids: string[] = [];
  for (const share of shares) {
    if (since - new Date(share.created_at).getTime() > SHARE_BURST_MS) break;
    if (!ids.includes(share.property_id)) ids.push(share.property_id);
  }
  return ids.slice(0, MAX_REFERENCED_SUBJECTS);
}

async function agentShiftVerdict(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  sharedId: string | null
): Promise<SubjectVerdict> {
  const { data: agentMessages } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(SUBJECT_LOOKBACK_MESSAGES);

  if (!agentMessages?.length) return { kind: 'unchanged' };

  const { data: candidates } = await db
    .from('properties')
    .select('id, project, title')
    .eq('account_id', accountId)
    .eq('status', 'Available');

  return resolveSubjectShift(
    agentMessages.map((m) => (m.content_text as string) || ''),
    (candidates ?? []) as SubjectCandidate[],
    sharedId
  );
}

/**
 * The listing a conversation is currently about, for every learner
 * that needs one.
 *
 * The share ledger answers it most of the time — the last listing sent
 * to this contact is the one they are reading. But an agent who types
 * "Have some inventories in Jade Gardens Devanahalli" has moved the
 * conversation without touching the ledger, and property_shares does
 * not even bump: recordPropertyShares upserts with ignoreDuplicates,
 * so created_at is the FIRST share.
 *
 * Left alone that misfires in both directions. A question gets answered
 * from a listing nobody is discussing; a price an agent quotes gets
 * filed against the wrong property. One resolver, so fixing it fixes
 * both.
 *
 * Returns null when the thread has moved somewhere that cannot be
 * pinned to a single listing. Callers read that as "don't guess" — the
 * Q&A hands over to a human, the learner files nothing.
 */
export async function resolvePropertySubject(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null
): Promise<string | null> {
  const shares = await recentShares(db, accountId, contactId);
  const sharedId = shares[0]?.property_id ?? null;
  if (!conversationId) return sharedId;

  const verdict = await agentShiftVerdict(
    db,
    accountId,
    conversationId,
    sharedId
  );
  if (verdict.kind === 'ambiguous') return null;
  if (verdict.kind === 'moved') return verdict.propertyId;
  return sharedId;
}

/**
 * Every listing a question may be about: the whole latest batch of
 * shares rather than its last card, so a buyer sent two listings in a
 * row and asking "where exactly?" hears both locations, each under its
 * title, instead of one of them with no way to tell which. An agent who
 * has since moved the thread to a single other listing still wins, and
 * a thread that cannot be pinned still answers nothing.
 */
export async function resolveSubjectProperties(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null
): Promise<string[]> {
  const shares = await recentShares(db, accountId, contactId);
  const burst = shareBurst(shares);
  if (!conversationId) return burst;

  const verdict = await agentShiftVerdict(
    db,
    accountId,
    conversationId,
    burst[0] ?? null
  );
  if (verdict.kind === 'ambiguous') return [];
  if (verdict.kind === 'moved') return [verdict.propertyId];
  return burst;
}
