// ============================================================
// "These two look like one deal" — party suggestions.
//
// Linking is manual, which means it only happens when an agent already
// knows. The signals that a couple or a set of colleagues are working
// one requirement are already in the book; this reads them.
//
// The hard rule, and the reason this is a separate module from
// duplicate-key.ts rather than an extra reason inside it: a shared
// phone or email means ONE PERSON RECORDED TWICE, which is a merge, and
// merging is destructive. Anything that looks like a duplicate is
// excluded here rather than offered as a party — the two verbs must
// never be confused in the UI, so they are never confused in the data.
//
// Ordered strongest first. Only the top reason for a pair is reported,
// so an agent sees one line per candidate rather than four.
// ============================================================

export type PartySuggestionReason =
  | 'same_property'
  | 'same_company'
  | 'email_domain'
  | 'shared_surname';

export interface SuggestionCandidate {
  id: string;
  name: string | null;
  second_name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  /** Property ids this contact has an active journey item on. */
  propertyIds?: string[];
}

export interface PartySuggestion {
  contactId: string;
  name: string | null;
  reason: PartySuggestionReason;
  /** What to show the agent as the evidence — a property id, a company
   *  name, a domain or a surname. Never invented. */
  detail: string;
}

/** Mailbox providers that say nothing about who someone buys with. A
 *  shared gmail.com is not a shared firm. */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'rediffmail.com',
  'icloud.com',
  'protonmail.com',
  'aol.com',
  'me.com',
]);

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function domainOf(email: string | null | undefined): string {
  const at = norm(email).split('@');
  return at.length === 2 ? at[1] : '';
}

/** Digits only, so +91 99452 33018 and 9945233018 compare equal. */
function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Whether these two records are a DUPLICATE rather than a party — the
 * same person saved twice. Such a pair is never suggested as a party:
 * it belongs in the merge flow, and offering it here would invite an
 * agent to link a record to itself and leave the real duplicate behind.
 */
export function looksLikeDuplicate(
  a: SuggestionCandidate,
  b: SuggestionCandidate
): boolean {
  const phoneA = phoneKey(a.phone);
  if (phoneA && phoneA === phoneKey(b.phone)) return true;
  const emailA = norm(a.email);
  return !!emailA && emailA === norm(b.email);
}

/**
 * Who this contact might be buying with, best evidence first.
 *
 * `alreadyLinked` carries every contact already in a party (anyone's),
 * because a contact belongs to at most one party — suggesting someone
 * who is spoken for would produce a refusal at the API rather than a
 * link. `dismissed` carries pair keys an agent has already rejected.
 */
export function suggestPartyMembers(
  subject: SuggestionCandidate,
  candidates: SuggestionCandidate[],
  alreadyLinked: Set<string> = new Set(),
  dismissed: Set<string> = new Set()
): PartySuggestion[] {
  if (alreadyLinked.has(subject.id)) return [];

  const subjectProperties = new Set(subject.propertyIds ?? []);
  const subjectCompany = norm(subject.company);
  const subjectDomain = domainOf(subject.email);
  const subjectSurname = norm(subject.second_name);

  const out: PartySuggestion[] = [];
  for (const other of candidates) {
    if (other.id === subject.id) continue;
    if (alreadyLinked.has(other.id)) continue;
    if (dismissed.has(suggestionPairKey(subject.id, other.id))) continue;
    if (looksLikeDuplicate(subject, other)) continue;

    const shared = (other.propertyIds ?? []).find((id) =>
      subjectProperties.has(id)
    );
    let reason: PartySuggestionReason | null = null;
    let detail = '';

    if (shared) {
      reason = 'same_property';
      detail = shared;
    } else if (subjectCompany && subjectCompany === norm(other.company)) {
      reason = 'same_company';
      detail = (other.company ?? '').trim();
    } else if (
      subjectDomain &&
      !FREE_EMAIL_DOMAINS.has(subjectDomain) &&
      subjectDomain === domainOf(other.email)
    ) {
      reason = 'email_domain';
      detail = subjectDomain;
    } else if (subjectSurname && subjectSurname === norm(other.second_name)) {
      reason = 'shared_surname';
      detail = (other.second_name ?? '').trim();
    }

    if (!reason) continue;
    out.push({ contactId: other.id, name: other.name, reason, detail });
  }

  const rank: Record<PartySuggestionReason, number> = {
    same_property: 0,
    same_company: 1,
    email_domain: 2,
    shared_surname: 3,
  };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason]);
}

/** Stable key for a pair, order-independent, so a dismissal sticks
 *  whichever contact the agent was looking at when they dismissed it. */
export function suggestionPairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}
