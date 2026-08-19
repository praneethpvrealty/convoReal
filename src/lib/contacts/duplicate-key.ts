import { normalisePhone, normaliseEmail } from '@/lib/contacts/find-or-create';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';

// The last-10 rule: the same person saved once from a WhatsApp webhook and
// once by hand is usually +919876543210 against 9876543210, which are two
// different digit strings and so were never grouped. Indian mobile numbers
// are 10 digits, so the trailing 10 are what identify the subscriber and
// anything in front is a country or trunk prefix.
//
// This only decides what to *offer* for merging — a person still confirms
// each merge — so pairing too eagerly costs a dismissed suggestion, while
// pairing too strictly costs a duplicate nobody is told about.
const SUBSCRIBER_DIGITS = 10;
const MIN_DIGITS = 7;

export function phoneMatchKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = normalisePhone(phone);
  if (digits.length < MIN_DIGITS) return null;
  return digits.length > SUBSCRIBER_DIGITS ? digits.slice(-SUBSCRIBER_DIGITS) : digits;
}

export function emailMatchKey(email: string | null): string | null {
  if (!email) return null;
  const normalised = normaliseEmail(email);
  return normalised.length > 0 ? normalised : null;
}

// A name is far weaker evidence than a number: two people really can both
// be Ravi Kumar, and a book of 250 contacts will contain repeats that are
// not duplicates. So the name rule is deliberately strict where the phone
// rule is generous — it demands a full name, because grouping every
// contact whose first name is Ravi would bury the real finds.
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'sri', 'smt', 'er', 'adv',
]);
const MIN_NAME_TOKENS = 2;
// Below this, one edit is too large a share of the word to call a typo.
const MIN_FUZZY_LENGTH = 8;
// One-character edits on short first/last names often create false positives
// ("Arun Kumar" vs "Arjun Kumar"), so require a materially substantive token
// before treating one-token variance as a typo.
const MIN_FUZZY_TOKEN_LENGTH = 5;
const SIMILARITY_FLOOR = 0.88;

export function nameMatchKey(name: string | null): string | null {
  // "Housing Lead" is two tokens and passes every test below, so without
  // this every portal lead filed under a placeholder would be offered as a
  // duplicate of every other one — a pile of unrelated buyers, on the
  // accounts that take the most portal leads.
  if (!name || isPlaceholderLeadName(name)) return null;
  const tokens = name
    .toLowerCase()
    // Source annotations travel with imported names: "Priya (MagicBricks)".
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t));

  if (tokens.length < MIN_NAME_TOKENS) return null;
  // Sorted so "Kumar Ravi" and "Ravi Kumar" land on the same key.
  return tokens.sort().join(' ');
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Whether two name keys differ by little enough to read as a typo. */
export function namesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < MIN_FUZZY_LENGTH) return false;
  const [left, right] = [a, b].map((name) =>
    name
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .sort(),
  );
  if (left.length !== right.length || left.length === 0) return false;

  const divergentTokens: Array<[string, string]> = [];
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      divergentTokens.push([left[i], right[i]]);
    }
  }

  if (divergentTokens.length === 0) return true;
  if (divergentTokens.length !== 1) return false;

  const [first, second] = divergentTokens[0];
  if (
    first.length < MIN_FUZZY_TOKEN_LENGTH ||
    second.length < MIN_FUZZY_TOKEN_LENGTH
  ) {
    return false;
  }

  const distance = editDistance(a, b);
  return 1 - distance / longest >= SIMILARITY_FLOOR;
}
