// ============================================================
// Who a forwarded chat is most likely about.
//
// A forward carries no sender identity and the chat header is usually
// cropped out, so the assistant asks who the client is. It can offer
// answers: the thread names things — the project the client cancelled,
// the property discussed — and one of those words sometimes belongs to
// exactly one contact.
//
// SOMETIMES. The first version of this offered "Surendra — mentions
// owner / Naveen — mentions owner / Keshav Reddy — mentions owner",
// because it mined the model's PARAPHRASE of the thread ("direct
// purchase from owner") and scored on a hand-written stop list that
// happened not to contain "owner". Both mistakes are fixed here and
// neither is fixable by lengthening a word list:
//
//   1. The terms come from what the client actually wrote, not from a
//      summary of it. A paraphrase introduces the summariser's
//      vocabulary, and that vocabulary is generic by construction.
//   2. A term earns its place by being RARE IN THIS BOOK, which the
//      caller measures rather than assumes. "Owner" matches eleven
//      contacts, so it identifies nobody; "Domlur" matches one, so it
//      identifies them. No list of English words can know that, and
//      every account's answer is different.
//
// Everything here is pure. It RANKS; it never picks. A candidate with
// no evidence is dropped rather than padded in — three names offered
// as a tap must each be there for a reason the agent can read, or the
// tap is a coin flip with a client's record as the stake.
// ============================================================

export interface CandidateContact {
  id: string;
  name: string | null;
  phone: string | null;
  lastActivity?: string | null;
}

/** What actually connects one contact to the forwarded thread. */
export interface CandidateEvidence {
  contact: CandidateContact;
  /** Rare terms the contact's own stated brief carries — what they
   *  told the agency they are after, in their file. */
  matchedTerms: string[];
  /** Rare terms that appear only in a note about them. Weaker on
   *  purpose: an agent writes "showed him the Domlur plot" about
   *  whoever they showed it to, so a note ties a contact to a subject
   *  far more loosely than their own brief does. */
  notedTerms?: string[];
  /** A name token the thread showed and this contact holds. */
  nameMatched: boolean;
  /** The thread showed this contact's number. Decisive. */
  phoneMatched: boolean;
}

export interface RankedCandidate {
  contact: CandidateContact;
  score: number;
  /** Why it is being offered, for the line under the buttons. */
  reason: string;
}

/** Words that name nothing in a real-estate thread. Kept short on
 *  purpose: the rarity measurement is what does the work, and a long
 *  list here would only hide how much it is doing. */
const GENERIC = new Set([
  'acre',
  'acres',
  'apartment',
  'bangalore',
  'bhk',
  'booking',
  'budget',
  'building',
  'buyer',
  'cancelled',
  'client',
  'commercial',
  'crore',
  'developer',
  'developers',
  'direct',
  'flat',
  'house',
  'land',
  'lakh',
  'looking',
  'morning',
  'owner',
  'plot',
  'previous',
  'project',
  'property',
  'purchase',
  'residential',
  'seller',
  'villa',
]);

/**
 * Candidate identifying words in the client's own message.
 *
 * A first pass at what to even ask the book about — proper nouns are
 * not marked as such in a chat, so length and the short stop list are
 * all that can be judged from the text alone. Whether a surviving term
 * identifies anybody is decided afterwards, by counting.
 */
export function distinctiveTerms(text: string, cap = 6): string[] {
  const seen = new Set<string>();
  for (const raw of (text || '').split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.toLowerCase();
    if (word.length < 5) continue;
    if (GENERIC.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    seen.add(word);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

/** Display form for a term the agent will read back: "domlur" is the
 *  needle, "Domlur" is the word they wrote. */
function titleCase(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

export function candidateReason(evidence: CandidateEvidence): string {
  if (evidence.phoneMatched) return 'same number as the chat';
  const parts: string[] = [];
  if (evidence.nameMatched) parts.push('name matches');
  if (evidence.matchedTerms.length) {
    parts.push(
      `brief mentions ${evidence.matchedTerms.slice(0, 2).map(titleCase).join(' and ')}`
    );
  } else if (evidence.notedTerms?.length) {
    parts.push(
      `a note mentions ${evidence.notedTerms.slice(0, 2).map(titleCase).join(' and ')}`
    );
  }
  return parts.join(', ');
}

/**
 * How strongly one contact answers "who is this?".
 *
 * The phone is decisive when the thread showed one. Otherwise a shared
 * name token beats a shared subject, because two contacts can both have
 * looked at Domlur but only one is called Natarajan.
 */
export function scoreEvidence(evidence: CandidateEvidence): number {
  if (evidence.phoneMatched) return 100;
  let score = 0;
  if (evidence.nameMatched) score += 40;
  score += 20 * evidence.matchedTerms.length;
  score += 8 * (evidence.notedTerms?.length ?? 0);
  return score;
}

/**
 * The best few candidates, strongest first, dropping anything that
 * matched on nothing. An empty result is a real answer: it means the
 * book has nothing to say about this thread, and the agent gets the
 * plain question instead of three guesses dressed as suggestions.
 */
export function rankClientCandidates(
  evidence: CandidateEvidence[],
  limit = 3
): RankedCandidate[] {
  return evidence
    .map((e) => ({
      contact: e.contact,
      score: scoreEvidence(e),
      reason: candidateReason(e),
    }))
    .filter((c) => c.score > 0 && c.reason)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.contact.lastActivity || '').localeCompare(
          a.contact.lastActivity || ''
        )
    )
    .slice(0, limit);
}
