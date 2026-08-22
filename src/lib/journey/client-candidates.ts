// ============================================================
// Who a forwarded chat is most likely about.
//
// A forward carries no sender identity — WhatsApp strips it — and the
// chat header the agent screenshotted is often cropped out. So the
// assistant asks who the client is, and the agent types the name.
//
// It can do better than a blank question. The thread names things:
// the project the client cancelled ("Lodha Sadhahalli"), the property
// discussed ("Domlur"), sometimes a first name. Those words appear in
// exactly one contact's brief and notes often enough to be worth
// offering as a tap.
//
// Everything here is pure and deterministic. It RANKS; it never picks.
// The agent taps, or types a different name, and an offered candidate
// that nobody taps costs nothing.
// ============================================================

import { normalisePhone } from '@/lib/contacts/find-or-create';

export interface CandidateContact {
  id: string;
  name: string | null;
  phone: string | null;
  /** The contact's stated brief, notes and enquiry titles, already
   *  concatenated by the caller — the text the thread is matched
   *  against. */
  haystack: string;
  /** Most recent activity, for the tie-break. */
  lastActivity?: string | null;
}

export interface CandidateSignals {
  clientName?: string | null;
  clientPhone?: string | null;
  /** Everything the forward said, in one string. */
  threadText: string;
}

export interface RankedCandidate {
  contact: CandidateContact;
  score: number;
  /** Why it is being offered, for the line under the buttons. */
  reason: string;
}

/** Words a real-estate thread is full of, which name nobody. */
const GENERIC = new Set([
  'acre',
  'acres',
  'apartment',
  'bangalore',
  'bhk',
  'booking',
  'budget',
  'building',
  'client',
  'commercial',
  'crore',
  'direct',
  'developer',
  'developers',
  'east',
  'flat',
  'floor',
  'good',
  'house',
  'is',
  'lakh',
  'land',
  'looking',
  'morning',
  'near',
  'north',
  'only',
  'plot',
  'project',
  'property',
  'purchase',
  'residential',
  'sale',
  'site',
  'south',
  'the',
  'villa',
  'west',
  'yes',
]);

/**
 * The words in a thread that could name one contact and not another —
 * a project, a locality, a builder. Case-folded, deduped, capped.
 *
 * Length is the whole filter alongside the stop list: a token under
 * five letters ("RE", "ok", "8cr") matches half the book, and matching
 * broadly here is worse than not matching at all, because a wrong
 * candidate offered as a tap is a wrong answer made easy.
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

function nameTokens(name: string | null | undefined): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * How well one contact answers "who is this?", and in one phrase why.
 *
 * The phone is decisive when the thread showed one — nothing else can
 * outrank it. Otherwise a shared name token beats a shared subject,
 * because two contacts can both have looked at Domlur but only one is
 * called Natarajan, and both beat mere recency, which is offered only
 * as an ordering among equals rather than as evidence.
 */
export function scoreCandidate(
  signals: CandidateSignals,
  contact: CandidateContact
): { score: number; reason: string } {
  const phone = normalisePhone(String(signals.clientPhone || ''));
  const contactPhone = normalisePhone(String(contact.phone || ''));
  if (
    phone.length >= 7 &&
    contactPhone.length >= 7 &&
    phone.slice(-10) === contactPhone.slice(-10)
  ) {
    return { score: 100, reason: 'same number as the chat' };
  }

  let score = 0;
  const reasons: string[] = [];

  const wanted = nameTokens(signals.clientName);
  const held = nameTokens(contact.name);
  const sharedName = wanted.filter((t) => t.length >= 3 && held.includes(t));
  if (sharedName.length) {
    score += 40 + sharedName.length * 5;
    reasons.push('name matches');
  }

  const haystack = (contact.haystack || '').toLowerCase();
  const hits = distinctiveTerms(signals.threadText).filter((term) =>
    haystack.includes(term)
  );
  if (hits.length) {
    score += 20 * hits.length;
    reasons.push(`mentions ${hits.slice(0, 2).join(' and ')}`);
  }

  return { score, reason: reasons.join(', ') };
}

/**
 * The best few candidates, strongest first. Anything that matched on
 * nothing is dropped rather than padded in: three names offered as a
 * tap must each be there for a reason the agent can see, or the tap is
 * a coin flip with a contact's record as the stake.
 */
export function rankClientCandidates(
  signals: CandidateSignals,
  contacts: CandidateContact[],
  limit = 3
): RankedCandidate[] {
  return contacts
    .map((contact) => ({ contact, ...scoreCandidate(signals, contact) }))
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.contact.lastActivity || '').localeCompare(
          a.contact.lastActivity || ''
        )
    )
    .slice(0, limit);
}
