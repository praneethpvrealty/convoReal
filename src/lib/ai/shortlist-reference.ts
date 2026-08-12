// ============================================================
// "Can you share location of Options 1 & 2? I will visit today."
//
// Every shortlist the bot sends is numbered, and two of them close by
// inviting the lead to use those numbers: "Reply with the number and
// I'll set it up." Nothing read them back. The subject resolver knows
// about the share ledger and about projects an agent named in passing,
// so a reply of "option 2" and nothing else resolved to whatever had
// been shared last — or to nothing at all, and the buyer was told a
// person would come back to them about a listing they had just
// numbered for us.
//
// The shortlist message is its own record. It carries the ordinals, and
// each entry carries either the property link (buildListingLines) or
// the title in bold (the buyer match digest), so the mapping is
// recoverable from the thread with no extra state to keep in step.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Highest ordinal worth reading. Shortlists are three long; the slack
 *  is for a digest, not for a number that is really a budget. */
const MAX_ORDINAL = 10;

/** Bot messages searched for the shortlist a reply is answering. */
const SHORTLIST_LOOKBACK_MESSAGES = 8;

/** Listings one question is answered about, so "1, 2 and 3 please" on a
 *  long digest cannot fan out into a paid call per row. */
export const MAX_REFERENCED_SUBJECTS = 3;

const WORD_ORDINALS: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
};

/**
 * A number the lead is using as a label rather than as a quantity.
 *
 * Bare digits only count when the whole message is digits and
 * separators ("2", "1 and 3"); anywhere else they need a marker in
 * front, or "3400 sqft in JP Nagar" selects listing three. Named
 * ordinals need something after them that means a listing, because
 * "1st Block" and "JP Nagar 4th Phase" are addresses, not choices.
 */
const MARKED_ORDINAL =
  /(?:\b(?:options?|opt|items?|numbers?|nos?|listings?|propert(?:y|ies)|prop)\.?\s*#?\s*|#\s*)(\d{1,2})/gi;
const BARE_ORDINAL_MESSAGE =
  /^[\s,&+/-]*\d{1,2}(?:\s*(?:,|&|\+|\/|and|-)\s*\d{1,2})*[\s.!]*$/i;
const NAMED_ORDINAL =
  /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b(?=\s*(?:one|option|listing|propert|plot|site|$|[.,?!]))/gi;
/** Further numbers hanging off a marked one — "options 1 & 2", "no. 1, 2 and 3". */
const ORDINAL_RUN = /\s*(?:,|&|\+|\/|and)\s*(\d{1,2})/y;

function inRange(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_ORDINAL;
}

/**
 * The listing numbers a lead is pointing at. Empty when the message
 * names none — the common case, which must stay cheap and silent.
 */
export function parseOrdinalReferences(text?: string | null): number[] {
  const value = (text || '').trim();
  if (!value) return [];

  const found: number[] = [];
  const push = (n: number) => {
    if (inRange(n) && !found.includes(n)) found.push(n);
  };

  if (BARE_ORDINAL_MESSAGE.test(value)) {
    for (const digits of value.match(/\d{1,2}/g) || []) push(Number(digits));
    return found.sort((a, b) => a - b);
  }

  for (const match of value.matchAll(NAMED_ORDINAL)) {
    push(WORD_ORDINALS[match[1].toLowerCase()]);
  }

  for (const match of value.matchAll(MARKED_ORDINAL)) {
    push(Number(match[1]));
    // "options 1 & 2" — the marker introduces a run, and only the
    // first number of it carries one.
    ORDINAL_RUN.lastIndex = (match.index ?? 0) + match[0].length;
    let run: RegExpExecArray | null;
    while ((run = ORDINAL_RUN.exec(value))) push(Number(run[1]));
  }

  return found.sort((a, b) => a - b);
}

export interface ShortlistEntry {
  ordinal: number;
  /** Read straight off the listing link when it carries a UUID. */
  propertyId: string | null;
  /** The brokerage's own code, which is what a branded link carries. */
  propertyCode: string | null;
  /** The listing's title, for the messages that carry no link. */
  title: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `property_id=` carries whichever key the link was built from —
 *  propertyShowcaseUrl prefers the brokerage's own property code. */
const PROPERTY_LINK = /property_id=([A-Za-z0-9_-]+)/;
const ENTRY_HEAD = /^\s*\*?(\d{1,2})\.\s+(.*)$/;

function entryFrom(ordinal: number, body: string[]): ShortlistEntry {
  const link = body.join('\n').match(PROPERTY_LINK);
  const key = link ? decodeURIComponent(link[1]) : null;
  const bold = body[0].match(/\*([^*]+)\*/);
  const plain = body[0].split(' — ')[0].replace(/\*/g, '').trim();
  return {
    ordinal,
    propertyId: key && UUID_RE.test(key) ? key.toLowerCase() : null,
    propertyCode: key && !UUID_RE.test(key) ? key : null,
    title: (bold ? bold[1].trim() : plain) || null,
  };
}

/**
 * A numbered shortlist message, back as its entries. Handles both
 * shapes the bot sends: `*1. Title*` above a link (buildListingLines,
 * and the preference tap reply through it) and `1. *Title* — ₹8.4 Cr`
 * (the buyer match digest, which carries one portal link for the whole
 * message and none per row).
 */
export function parseNumberedListing(text?: string | null): ShortlistEntry[] {
  const entries: ShortlistEntry[] = [];
  let ordinal = 0;
  let body: string[] = [];

  for (const line of (text || '').split('\n')) {
    const head = line.match(ENTRY_HEAD);
    if (head && inRange(Number(head[1]))) {
      if (ordinal) entries.push(entryFrom(ordinal, body));
      ordinal = Number(head[1]);
      body = [head[2]];
      continue;
    }
    if (ordinal) body.push(line);
  }
  if (ordinal) entries.push(entryFrom(ordinal, body));

  return entries;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Property ids for the listing numbers a lead named, or an empty list
 * when the thread holds no shortlist to number against.
 *
 * Titles are matched whole and normalized, never loosely: an entry that
 * cannot be pinned to exactly one live listing is dropped rather than
 * guessed at, because the caller answers a buyer's question from
 * whatever comes back.
 */
export async function resolveShortlistReference(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  text: string
): Promise<string[]> {
  const ordinals = parseOrdinalReferences(text);
  if (ordinals.length === 0) return [];

  const { data: botMessages } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'bot')
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(SHORTLIST_LOOKBACK_MESSAGES);

  let entries: ShortlistEntry[] = [];
  for (const row of botMessages || []) {
    const parsed = parseNumberedListing(row.content_text as string);
    if (parsed.length > 0) {
      entries = parsed;
      break;
    }
  }

  const wanted = ordinals
    .map((n) => entries.find((e) => e.ordinal === n))
    .filter((e): e is ShortlistEntry => !!e)
    .slice(0, MAX_REFERENCED_SUBJECTS);
  if (wanted.length === 0) return [];

  const linked = wanted
    .map((e) => e.propertyId)
    .filter((id): id is string => !!id);
  if (linked.length === wanted.length) return linked;

  // One builder composes a whole shortlist, so its entries all carry
  // the same kind of key: codes when the links were branded, titles for
  // the digest, which links nothing per row. Bounded by
  // MAX_REFERENCED_SUBJECTS either way, and every value came out of a
  // message we composed from these same rows — never off the wire.
  const codes = wanted
    .map((e) => e.propertyCode)
    .filter((c): c is string => !!c);
  const titles = wanted.map((e) => e.title).filter((t): t is string => !!t);
  const [column, values] =
    codes.length > 0
      ? (['property_code', codes] as const)
      : (['title', titles] as const);
  if (values.length === 0) return linked;

  const { data: candidates } = await db
    .from('properties')
    .select('id, title, property_code')
    .eq('account_id', accountId)
    .in(column, values);

  const byCode = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  for (const row of candidates || []) {
    const code = ((row.property_code as string) || '').toUpperCase();
    if (code) byCode.set(code, [...(byCode.get(code) || []), row.id as string]);
    const key = normalizeTitle((row.title as string) || '');
    if (key) byTitle.set(key, [...(byTitle.get(key) || []), row.id as string]);
  }

  // Only ever one hit: an entry we cannot pin to exactly one live
  // listing is dropped, because answering from the wrong one is worse
  // than telling the buyer a person will come back to them.
  const only = (hits?: string[]) => (hits?.length === 1 ? hits[0] : null);

  return wanted
    .map(
      (entry) =>
        entry.propertyId ??
        (entry.propertyCode
          ? only(byCode.get(entry.propertyCode.toUpperCase()))
          : null) ??
        (entry.title ? only(byTitle.get(normalizeTitle(entry.title))) : null)
    )
    .filter((id): id is string => !!id);
}
