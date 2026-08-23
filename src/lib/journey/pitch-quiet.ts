// ============================================================
// The date a client asked to be left until.
//
// A buyer answered a journey check-in with "By the 5th of September"
// and was pitched a new listing fourteen seconds later. Asking someone
// when to come back and then not waiting tells them the question was a
// formality.
//
// What this mutes is narrow on purpose: UNPROMPTED new-listing pitches.
// Alerts a contact explicitly opted into keep flowing — they asked for
// those — and so does every reply to something they just sent. A quiet
// window is not a mute, and treating it as one would cost a client the
// answer they were waiting for.
//
// Pure. The reader is deliberate about what it will not read: a date it
// guesses wrong either silences a live thread for weeks or reopens it
// tomorrow, and both are worse than the fallback below.
// ============================================================

import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  isBefore,
  setDate,
  setMonth,
  startOfDay,
} from 'date-fns';

/** How long "can't say yet" buys. They said they cannot commit; asking
 *  again tomorrow is exactly the behaviour that answer is refusing. */
export const UNCOMMITTED_QUIET_DAYS = 7;

/** Nothing is held past this — a brief that goes quiet forever is a
 *  lead nobody ever picks back up. */
export const MAX_QUIET_DAYS = 120;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// Two shapes, each swept across the whole string: "5th of September"
// and "Sept 5". Both are tried at every position rather than at the
// first hit, because "By the 5th of September" offers "the 5" to a
// month-then-day reader before it ever reaches the month — and "the"
// is not a month, which is the check that settles it.
const DAY_THEN_MONTH =
  /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\b/gi;
const MONTH_THEN_DAY = /\b([a-z]{3,})\.?\s+(\d{1,2})\s*(?:st|nd|rd|th)?\b/gi;
const IN_N =
  /\b(?:in|after)\s+(?:a\s+|another\s+)?(\d{1,3}|a|couple of|few)\s*(day|week|month)s?\b/i;
const NEXT_UNIT = /\bnext\s+(week|month)\b/i;
const TOMORROW = /\btomorrow\b/i;

function monthIndex(word: string): number {
  const lower = (word || '').toLowerCase();
  if (lower.length < 3) return -1;
  return MONTHS.findIndex(
    (m) =>
      m.startsWith(lower.slice(0, 3)) && m.startsWith(lower.slice(0, m.length))
  );
}

/** The first day+month pair in the text whose month word is a month. */
function readDayAndMonth(value: string): { day: number; month: number } | null {
  const candidates: { day: number; month: number; at: number }[] = [];
  for (const m of value.matchAll(DAY_THEN_MONTH)) {
    candidates.push({
      day: parseInt(m[1], 10),
      month: monthIndex(m[2]),
      at: m.index ?? 0,
    });
  }
  for (const m of value.matchAll(MONTH_THEN_DAY)) {
    candidates.push({
      day: parseInt(m[2], 10),
      month: monthIndex(m[1]),
      at: m.index ?? 0,
    });
  }
  const valid = candidates
    .filter((c) => c.month >= 0 && c.day >= 1 && c.day <= 31)
    .sort((a, b) => a.at - b.at);
  return valid[0] ? { day: valid[0].day, month: valid[0].month } : null;
}

function countWord(word: string): number {
  const lower = word.toLowerCase();
  if (lower === 'a') return 1;
  if (lower === 'couple of') return 2;
  if (lower === 'few') return 3;
  const n = parseInt(lower, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * When the client said to come back, or null when the text names no
 * date this can be sure of.
 *
 * Null is the common, correct answer — "will let you know", "after we
 * discuss internally". The caller falls back to a short window rather
 * than inventing a long one.
 */
export function parseCheckBackDate(
  text: string | null | undefined,
  now: Date = new Date()
): Date | null {
  const value = (text || '').trim();
  if (!value) return null;

  if (TOMORROW.test(value)) return endOfDay(addDays(now, 1));

  const nextUnit = value.match(NEXT_UNIT);
  if (nextUnit) {
    return endOfDay(
      nextUnit[1].toLowerCase() === 'week'
        ? addWeeks(now, 1)
        : addMonths(now, 1)
    );
  }

  const inN = value.match(IN_N);
  if (inN) {
    const count = countWord(inN[1]);
    const unit = inN[2].toLowerCase();
    if (count > 0) {
      const base =
        unit === 'day'
          ? addDays(now, count)
          : unit === 'week'
            ? addWeeks(now, count)
            : addMonths(now, count);
      return endOfDay(base);
    }
  }

  const dayMonth = readDayAndMonth(value);
  if (dayMonth) {
    let candidate = endOfDay(
      setDate(setMonth(startOfDay(now), dayMonth.month), dayMonth.day)
    );
    // "the 5th of September" said in September means this year; said in
    // December it means next.
    if (isBefore(candidate, now)) candidate = addMonths(candidate, 12);
    return candidate;
  }

  return null;
}

/** Clamps a read date into what a quiet window may actually hold. */
export function quietUntilFrom(
  date: Date | null,
  now: Date = new Date()
): Date {
  const ceiling = endOfDay(addDays(now, MAX_QUIET_DAYS));
  const floor = endOfDay(addDays(now, UNCOMMITTED_QUIET_DAYS));
  if (!date) return floor;
  if (isBefore(date, now)) return floor;
  return isBefore(ceiling, date) ? ceiling : date;
}

/** True while unprompted new-listing pitches should hold off. */
export function isPitchQuiet(
  contact: { pitch_quiet_until?: string | null },
  now: Date = new Date()
): boolean {
  const until = contact.pitch_quiet_until;
  if (!until) return false;
  const parsed = new Date(until);
  return Number.isFinite(parsed.getTime()) && isBefore(now, parsed);
}
