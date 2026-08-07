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
    if (project.length >= MIN_PROJECT_NAME && containsPhrase(haystack, project)) {
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
