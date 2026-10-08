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

/** Human messages read back when deciding what the subject is. Far
 *  enough to catch a project pitched a few turns ago, short enough that
 *  a listing named yesterday does not outrank today's. */
const SUBJECT_LOOKBACK_MESSAGES = 30;

/** Ledger rows read back. A re-share does not bump its row, so the
 *  newest rows are a floor, not the answer. */
const SHARE_LOOKBACK_ROWS = 5;

/** Two different listings shared this close together arrive as one
 *  burst: a buyer's next "is this available?" could mean either. */
const SHARE_BURST_WINDOW_MS = 5 * 60 * 1000;

/** Shortest title worth matching in full. Below this a title is a
 *  phrase ("Plot A") that turns up in ordinary chatter. */
const MIN_TITLE_LENGTH = 15;

export interface ListingRef extends SubjectCandidate {
  property_code?: string | null;
  status?: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ids of the listings a message points at by name: its property code
 * first — the showcase enquiry stamps "(Property ID: PROP-1110)" and
 * every share link carries "property_id=PROP-1784" — else its full
 * title. A title that is only part of a longer matched title is the
 * same mention, not a second listing.
 */
export function listingsReferencedIn(
  text: string,
  candidates: ListingRef[]
): string[] {
  const raw = text || '';
  if (!raw.trim()) return [];

  const byCode = new Set<string>();
  for (const candidate of candidates) {
    const code = (candidate.property_code || '').trim();
    if (code.length < 3) continue;
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9-])${escapeRegExp(code)}(?![A-Za-z0-9-])`,
      'i'
    );
    if (pattern.test(raw)) byCode.add(candidate.id);
  }
  if (byCode.size > 0) return [...byCode];

  const haystack = normalize(raw);
  const titled = candidates
    .map((candidate) => ({
      id: candidate.id,
      title: normalize(candidate.title || ''),
    }))
    .filter(
      (candidate) =>
        candidate.title.length >= MIN_TITLE_LENGTH &&
        containsPhrase(haystack, candidate.title)
    );
  return titled
    .filter(
      (candidate) =>
        !titled.some(
          (other) =>
            other.title.length > candidate.title.length &&
            containsPhrase(other.title, candidate.title)
        )
    )
    .map((candidate) => candidate.id);
}

export interface ThreadMessage {
  sender: string;
  text: string;
  at: string;
  messageId?: string | null;
}

export interface ShareRecord {
  propertyId: string;
  at: string;
}

/**
 * Which listing the thread is about, from everything the thread says.
 *
 * Strongest first:
 *
 * 1. The message the buyer quoted. Swiping to reply on a share is the
 *    buyer pointing at one listing; on 7 October a buyer quoted the
 *    40,000 sq.ft. share and was answered about the listing shared a
 *    minute after it.
 * 2. A listing the buyer named since the last share — the showcase
 *    enquiry they sent seconds ago. On 7 October "Is this available?"
 *    under an Akshay Nagar enquiry was answered from the afternoon's
 *    under-contract plot, because the enquiry had not reached the share
 *    ledger yet, and an available listing was called taken.
 * 3. A listing an agent has since pitched (resolveSubjectShift).
 * 4. Two different listings shared back to back, with no word from the
 *    buyer in between, cannot be told apart: null, so a person answers.
 * 5. The latest share.
 *
 * "Since" and "latest" are measured against the real last share, which
 * the ledger alone cannot give: recordPropertyShares upserts with
 * ignoreDuplicates, so a listing re-sent today still carries the date
 * it was first sent. Every outbound message that names exactly one
 * listing — a share, its image caption, an enquiry acknowledgement —
 * counts as sharing it at that moment. Anything said before the latest
 * share is history the share superseded.
 *
 * Whichever of 2 and 3 was said more recently decides. A quote or a
 * message naming several listings is ambiguous, never a guess.
 */
export function decideSubject(args: {
  /** Customer, agent and bot messages, newest first. */
  messages: ThreadMessage[];
  /** Ledger rows, newest first. */
  shares: ShareRecord[];
  candidates: ListingRef[];
  quotedText?: string | null;
  /** The inbound message being answered, so it is not counted as the
   *  buyer having spoken since the last share. */
  currentMessageId?: string | null;
}): string | null {
  const { messages, shares, candidates } = args;

  if (args.quotedText) {
    const quoted = listingsReferencedIn(args.quotedText, candidates);
    if (quoted.length === 1) return quoted[0];
    if (quoted.length > 1) return null;
  }

  const sharedAt = new Map<string, number>();
  const noteShare = (propertyId: string, at: number) => {
    if (!Number.isFinite(at)) return;
    if (at > (sharedAt.get(propertyId) ?? Number.NEGATIVE_INFINITY)) {
      sharedAt.set(propertyId, at);
    }
  };
  for (const share of shares) noteShare(share.propertyId, Date.parse(share.at));
  for (const message of messages) {
    if (message.sender === 'customer') continue;
    const named = listingsReferencedIn(message.text, candidates);
    if (named.length === 1) noteShare(named[0], Date.parse(message.at));
  }
  const events = [...sharedAt.entries()]
    .map(([propertyId, at]) => ({ propertyId, at }))
    .sort((a, b) => b.at - a.at);

  const latest = events[0] ?? null;
  const sharedId = latest?.propertyId ?? null;
  const latestAt = latest?.at ?? Number.NEGATIVE_INFINITY;
  const available = candidates.filter(
    (candidate) => (candidate.status ?? 'Available') === 'Available'
  );

  for (const message of messages) {
    if (Date.parse(message.at) <= latestAt) break;
    if (message.sender === 'customer') {
      const named = listingsReferencedIn(message.text, candidates);
      if (named.length === 1) return named[0];
      if (named.length > 1) return null;
      continue;
    }
    if (message.sender !== 'agent') continue;
    const verdict = resolveSubjectShift([message.text], available, sharedId);
    if (verdict.kind === 'moved') return verdict.propertyId;
    if (verdict.kind === 'ambiguous') return null;
    if (propertiesNamedIn(message.text, available).length > 0) break;
  }

  const previous = events[1] ?? null;
  if (latest && previous && latestAt - previous.at <= SHARE_BURST_WINDOW_MS) {
    const buyerSpokeSince = messages.some(
      (message) =>
        message.sender === 'customer' &&
        Date.parse(message.at) > latestAt &&
        (!args.currentMessageId || message.messageId !== args.currentMessageId)
    );
    if (!buyerSpokeSince) return null;
  }

  return sharedId;
}

export interface InboundSubjectContext {
  /** WhatsApp id of the inbound message being answered. */
  messageId?: string | null;
  /** WhatsApp id of the message it quotes, when the buyer swiped to
   *  reply. */
  quotedMessageId?: string | null;
}

/**
 * The listing a conversation is currently about, for every reader that
 * needs one: the lead Q&A, photo requests, disinterest, and the agent
 * price learner.
 *
 * The share ledger answers it most of the time, but property_shares
 * does not even bump — recordPropertyShares upserts with
 * ignoreDuplicates, so created_at is the FIRST share — and it knows
 * nothing about a listing the buyer just enquired about, quoted, or an
 * agent pitched in prose. decideSubject reconciles all of them.
 *
 * Returns null when the thread cannot be pinned to a single listing.
 * Callers read that as "don't guess" — the Q&A hands over to a human,
 * the learner files nothing.
 */
export async function resolvePropertySubject(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null,
  inbound?: InboundSubjectContext
): Promise<string | null> {
  const { data: shareRows } = await db
    .from('property_shares')
    .select('property_id, created_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(SHARE_LOOKBACK_ROWS);

  const shares: ShareRecord[] = (shareRows ?? []).map((row) => ({
    propertyId: row.property_id as string,
    at: row.created_at as string,
  }));
  if (!conversationId) return shares[0]?.propertyId ?? null;

  const [{ data: messageRows }, { data: quoted }, { data: candidates }] =
    await Promise.all([
      db
        .from('messages')
        .select('sender_type, content_text, created_at, message_id')
        .eq('conversation_id', conversationId)
        .in('sender_type', ['customer', 'agent', 'bot'])
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(SUBJECT_LOOKBACK_MESSAGES),
      inbound?.quotedMessageId
        ? db
            .from('messages')
            .select('content_text')
            .eq('conversation_id', conversationId)
            .eq('message_id', inbound.quotedMessageId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('properties')
        .select('id, project, title, property_code, status')
        .eq('account_id', accountId),
    ]);

  return decideSubject({
    messages: (messageRows ?? []).map((row) => ({
      sender: row.sender_type as string,
      text: (row.content_text as string) || '',
      at: row.created_at as string,
      messageId: (row.message_id as string | null) ?? null,
    })),
    shares,
    candidates: (candidates ?? []) as ListingRef[],
    quotedText:
      ((quoted as { content_text?: string | null } | null)?.content_text as
        string | null | undefined) ?? null,
    currentMessageId: inbound?.messageId ?? null,
  });
}
