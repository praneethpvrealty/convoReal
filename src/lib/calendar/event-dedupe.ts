// ============================================================
// The row a dictated request is about, when it is about one that
// already exists.
//
// Saying the same thing twice is normal — an agent dictates a note
// walking out of a meeting and again from the car, or repeats a job
// the next morning because they cannot remember whether it went in.
// Each pass used to insert another row, so the calendar filled with
// pairs and the to-do list with the same job three times.
//
// The rule is deliberately narrow, because merging two events that
// were never the same one loses a real appointment: same subject AND
// same day, or for an undated to-do, same subject and no day on
// either side. Two site visits with the same buyer in one week are
// two visits and stay two rows. A reschedule is not this — that is a
// quote-reply on the card, which names its target outright
// (applySchedulingEdit).
//
// Pure functions only; the caller does the querying. Same split as
// event-parse: nothing here talks to Supabase or to a model.
// ============================================================

/** Words that carry no subject on their own, so two titles that differ
 *  only by them are the same subject stated twice. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'my',
  'our',
  'their',
  'his',
  'her',
  'mr',
  'mrs',
  'ms',
  'sir',
  'madam',
]);

/** Content words of a title, lowercased and stripped of punctuation.
 *  Possessives go too — "Kusumaraju's advocate" and "Kusumaraju
 *  advocate" are one subject. */
export function titleTokens(title: string): string[] {
  return (title || '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

/**
 * How much two titles say the same thing, 0 to 1.
 *
 * Overlap against the SHORTER token set, not the union: the model
 * summarises the same job at different lengths on different passes
 * ("Follow up with the advocate" / "Follow up with Kusumaraju's
 * advocate about the sale deed"), and a union-based score punishes the
 * longer one for carrying more detail about the very same thing.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/** Titles this close are treated as the same subject. Two thirds of the
 *  shorter title has to match, so "call the advocate" and "call the
 *  builder" stay apart while a re-worded repeat of one job lands. */
export const SAME_SUBJECT = 0.67;

/** The IST calendar day an instant falls on, as YYYY-MM-DD. Two rows on
 *  the same day are candidates; the same wall-clock hour is not
 *  required, because the second telling often rounds the time. */
export function istDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export interface ExistingRow {
  id: string;
  title: string;
  /** start_time for an appointment, due_date for a to-do. Null only for
   *  a to-do dictated without a day. */
  when: string | null;
  contact_id?: string | null;
  liaison_id?: string | null;
}

export interface DuplicateQuery {
  title: string;
  when: string | null;
  contactId?: string | null;
  liaisonId?: string | null;
}

/** Two rows that each name a party, naming different ones, are about
 *  different people whatever their titles say. "Site visit" is a title
 *  two agents write for two buyers on one afternoon, so this is what
 *  stops the wording alone from merging them. A row with no party named
 *  contradicts nothing. */
function partiesConflict(query: DuplicateQuery, row: ExistingRow): boolean {
  const contactClash =
    !!query.contactId && !!row.contact_id && query.contactId !== row.contact_id;
  const liaisonClash =
    !!query.liaisonId && !!row.liaison_id && query.liaisonId !== row.liaison_id;
  return contactClash || liaisonClash;
}

/**
 * The existing row this request restates, or null to file a new one.
 *
 * Three things have to hold: the same IST day, wording that clears
 * SAME_SUBJECT, and no contradiction about who it is with. The day is
 * what keeps a weekly recurring visit as separate rows; the party check
 * is what keeps two identically-titled visits with different buyers
 * apart. Both directions matter — a missed duplicate leaves a tidy-up,
 * a wrong merge loses a real appointment.
 *
 * Ties break toward the row whose title is closest in length, so a
 * restatement wins over a longer entry that merely contains it rather
 * than whichever row the database happened to return first.
 */
export function findDuplicate(query: DuplicateQuery, rows: ExistingRow[]): ExistingRow | null {
  const queryDay = query.when ? istDayKey(query.when) : null;
  const queryLength = titleTokens(query.title).length;

  let best: ExistingRow | null = null;
  let bestScore = 0;
  let bestDistance = Infinity;
  for (const row of rows) {
    const rowDay = row.when ? istDayKey(row.when) : null;
    // An undated to-do only ever matches another undated one: giving a
    // repeat a due date is new information, not a duplicate.
    if (queryDay !== rowDay) continue;
    if (partiesConflict(query, row)) continue;

    const similarity = titleSimilarity(query.title, row.title);
    if (similarity < SAME_SUBJECT) continue;

    const distance = Math.abs(titleTokens(row.title).length - queryLength);
    if (similarity > bestScore || (similarity === bestScore && distance < bestDistance)) {
      best = row;
      bestScore = similarity;
      bestDistance = distance;
    }
  }
  return best;
}
