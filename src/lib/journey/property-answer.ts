// ============================================================
// The answer to "which property is this about?".
//
// A forwarded client reply that names no listing is logged against the
// contact and the agent is asked which property it belongs to. The
// agent then types the code — "Prop-1194" — and that message used to
// reach the listing classifier, which read a bare code as a brand-new
// listing and opened a draft with every field Missing. The bot asked a
// question and then could not hear the answer.
//
// Pure text: the prompt the question is sent as, the fingerprint that
// finds it again in the thread, and the reader for what an agent types
// back. The completion itself lives in client-response.ts, which holds
// the records.
// ============================================================

import { extractMapLinkFromText } from '@/lib/maps/map-links';

/** The question, verbatim. One source of truth so the copy that goes
 *  out and the fingerprint that finds it cannot drift apart. */
export const PROPERTY_QUESTION_PROMPT =
  "I couldn't tell which property this is about, so the journey wasn't updated. Reply with the property name or code (e.g. PROP-1138), or forward a screenshot showing it.";

/** Finds that question in a stored bot message. Matched on the stable
 *  half of the sentence, so a copy tweak around it stays harmless. */
export const PROPERTY_QUESTION_FINGERPRINT =
  /couldn't tell which property this is about/i;

export interface PropertyAnswer {
  /** A property code the agent typed, normalised to PROP-<n>. */
  code?: string;
  /** A listing name, when no code was given. Resolved by the caller,
   *  which requires a single unambiguous hit. */
  title?: string;
}

/** Longer than this and the message is saying something else — an
 *  update, a question, a fresh listing — not naming a listing. */
const MAX_ANSWER_LEN = 60;

const CODE = /\bprop[\s_-]*(\d{1,6})\b/i;

const LINK = /(?:https?:\/\/|\bwww\.)\S/i;

/**
 * What the agent named, or null when the message is not an answer to
 * the property question.
 *
 * Deliberately narrow: this only ever runs when the bot's own question
 * is standing in the thread, and a wrong reading there costs a journey
 * update filed against the wrong listing.
 */
export function parsePropertyAnswer(
  text?: string | null
): PropertyAnswer | null {
  const value = (text || '').trim();
  if (!value || value.length > MAX_ANSWER_LEN) return null;

  const code = value.match(CODE);
  if (code) return { code: `PROP-${code[1]}` };

  // No code: the prompt also invites the name. Needs enough letters to
  // stand a chance of matching one listing and only one — the resolver
  // refuses an ambiguous hit either way, and a link is a URL's worth of
  // letters that names nothing.
  if (LINK.test(value) || extractMapLinkFromText(value)) return null;
  const letters = value.replace(/[^a-z]/gi, '');
  if (letters.length < 6) return null;
  return { title: value };
}

/**
 * The summary out of a logged-response contact note, so a deferred
 * completion can name what the client actually said instead of filing
 * a generic "responded". Mirrors the note format written when the
 * response was first logged.
 */
export function extractLoggedSummary(
  noteText: string | null | undefined
): string | null {
  const value = (noteText || '').trim();
  if (!value.startsWith('💬')) return null;
  const quoted = value.match(/"([\s\S]+)"/);
  const summary = quoted?.[1]?.trim();
  return summary || null;
}
