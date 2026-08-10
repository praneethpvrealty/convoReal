// ============================================================
// Matching a parsed contact draft against the book we already have.
//
// A forwarded WhatsApp chat is the common intake, and it carries no
// phone number — the header shows whatever name the agent saved, and
// that name usually carries qualifiers the Engine row does not:
// "Vasundhara Purva Atmosphere Interested" against a contact filed as
// "Vasundhara". So the draft arrived phoneless, could not be
// confirmed, and the budget and requirements in the conversation had
// nowhere to land.
//
// Everything here is deterministic and returns candidates rather than
// acting. Writing one buyer's budget onto another buyer's record is
// not an error anybody catches by reading the contact later.
// ============================================================

import { normalisePhone } from '@/lib/contacts/find-or-create';

export interface BookContact {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface DraftFields {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  requirements?: string | null;
  name_tag?: string | null;
}

function tokens(name: string | null | undefined): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The one contact this draft is plainly about, or null.
 *
 * The rule is prefix containment in either direction — the saved name
 * starts with the book name, or the book name starts with the saved
 * one — because the extra words in a phonebook name are qualifiers
 * appended to the end ("Vasundhara Purva Atmosphere Interested"), not
 * a different person.
 *
 * Two guards keep that from being reckless:
 *
 * - EXACTLY ONE candidate. Two Ravis in the book means the draft named
 *   "Ravi" resolves to neither, which is the honest answer.
 * - The shorter name must carry a real token. A one-letter initial
 *   prefixes half the book.
 *
 * This only suggests a phone for a draft that has none; the agent
 * still confirms the card. Nothing is written from a guess.
 */
export function matchContactByName(
  draftName: string | null | undefined,
  book: BookContact[]
): BookContact | null {
  const draft = tokens(draftName);
  if (!draft.length) return null;

  const hits = book.filter((c) => {
    const other = tokens(c.name);
    if (!other.length) return false;
    const [shorter, longer] = other.length <= draft.length ? [other, draft] : [draft, other];
    // A single initial is not a name, and matches far too much.
    if (shorter.length === 1 && shorter[0].length < 3) return false;
    return shorter.every((t, i) => t === longer[i]);
  });

  return hits.length === 1 ? hits[0] : null;
}

/** The book row this draft's phone already points at, if any. */
export function matchContactByPhone(
  phone: string | null | undefined,
  book: BookContact[]
): BookContact | null {
  const digits = normalisePhone(String(phone || ''));
  if (digits.length < 7) return null;
  const tail = digits.slice(-10);
  return (
    book.find((c) => {
      const other = normalisePhone(String(c.phone || ''));
      return other.length >= 7 && other.slice(-10) === tail;
    }) || null
  );
}

export interface ContactEnrichment {
  /** Column updates — only ever fills blanks, never overwrites. */
  updates: Record<string, string>;
  /** Free text to append to the requirement brief, or null. */
  requirements: string | null;
  /** Human summary of what changed, for the confirmation card. */
  changed: string[];
}

/**
 * What a draft adds to a contact that already exists.
 *
 * Additive by construction. A forwarded chat is one snapshot of a long
 * relationship, and the agent's own edits in the CRM are worth more
 * than an extraction — so a field the contact already has is left
 * alone, and requirements are appended rather than replaced.
 *
 * The reason this exists at all: an existing contact used to be
 * reported as a "skipped duplicate", which threw away every
 * requirement and budget the conversation carried.
 */
export function enrichmentFor(
  draft: DraftFields,
  existing: {
    email?: string | null;
    company?: string | null;
    name_tag?: string | null;
    requirements?: string | null;
  }
): ContactEnrichment {
  const updates: Record<string, string> = {};
  const changed: string[] = [];

  const fill = (key: 'email' | 'company' | 'name_tag', label: string) => {
    const value = (draft[key] || '').trim();
    const held = (existing[key] || '').trim();
    if (value && !held) {
      updates[key] = value;
      changed.push(label);
    }
  };
  fill('email', 'email');
  fill('company', 'company');
  fill('name_tag', 'name tag');

  const brief = [draft.requirements, draft.notes]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n');
  const held = (existing.requirements || '').trim();
  const fresh = brief && !held.toLowerCase().includes(brief.toLowerCase()) ? brief : null;
  if (fresh) changed.push('requirements');

  return {
    updates,
    requirements: fresh ? (held ? `${held}\n${fresh}` : fresh) : null,
    changed,
  };
}
