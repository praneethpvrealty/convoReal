// ============================================================
// The answer to "who is this client?".
//
// A forwarded chat whose client the Engine could not name ended the
// exchange: "save them as a contact first, then forward the chat
// again". The agent's own answer — "Natarajan is already a contact in
// our application" — then reached the intake classifier as a fresh
// message and came back as "I couldn't tell what that was", while the
// client's actual reply, already parsed, sat unused.
//
// Pure text: the question the assistant asks, the fingerprint that
// finds it again in the thread, and the reader for the name an agent
// types back. The matching and the logging live in
// client-response.ts, which holds the records.
// ============================================================

/** The question, verbatim. One source of truth so the copy that goes
 *  out and the fingerprint that finds it cannot drift apart. */
export const CLIENT_QUESTION_PROMPT =
  "Reply with their name as it's saved in your book (e.g. \"it's Natarajan\"), or send their contact card and I'll save them first.";

/** Longer than this and the message is saying something else — a
 *  listing, an instruction, an update — not naming a person. */
const MAX_ANSWER_LEN = 90;

/** Openers an agent puts in front of the name. Stripped, not matched
 *  on: the bare name is the commonest answer of all. */
const LEAD_IN =
  /^(?:it'?s|its|this is|that'?s|that is|he'?s|she'?s|the client is|client is|contact is|(?:his|her|their) name is|name is|name)\b[\s:,-]*/i;

/** Where a name stops and the agent's point about it begins. Only
 *  predicates: a continuation like "the Sarjapur brochure" is a
 *  sentence that happens to start with a capitalised word, not a name
 *  with a comment after it. */
const PREDICATE =
  /^(?:is|was|isn'?t|are|already|has|have|had|exists?|saved|came|replied)$/i;

const RELATIONSHIP_CLAUSE =
  /\s+(?:and|,)\s+(?=(?:(?:the|his|her|their)\s+)?(?:property\s+)?(?:owner|seller|agent|referrer|facilitator)\b)/i;

/** A name past this many words is a sentence. */
const MAX_NAME_WORDS = 4;

const CODE = /\bprop[\s_-]*\d{1,6}\b/i;
const LINK = /(?:https?:\/\/|\bwww\.)\S/i;

/**
 * The contact name the agent named, or null when the message is not an
 * answer to the who-question.
 *
 * Deliberately narrow: this only ever runs while a parked reply of the
 * agent's own is waiting on a name, and a wrong reading there files
 * one client's words onto another client's journey. The resolver on
 * the other side still refuses an ambiguous book match, so a name that
 * fits two contacts resolves to neither.
 */
export function parseClientNameAnswer(text?: string | null): string | null {
  const value = (text || '').trim().replace(/^["'\u201c]|["'\u201d.!]+$/g, '');
  if (!value || value.length > MAX_ANSWER_LEN) return null;
  if (LINK.test(value) || CODE.test(value)) return null;

  const answer = value.split(RELATIONSHIP_CLAUSE, 1)[0];
  const words = answer.replace(LEAD_IN, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  const name: string[] = [];
  for (const word of words) {
    if (name.length && PREDICATE.test(word)) break;
    if (name.length && /^(?:and|or)$/i.test(word)) return null;
    if (name.length === MAX_NAME_WORDS) return null;
    if (!/^[\p{L}][\p{L}'.-]*$/u.test(word)) return null;
    name.push(word);
  }

  const joined = name.join(' ').replace(/[.\s]+$/, '');
  if (joined.replace(/[^\p{L}]/gu, '').length < 3) return null;
  return joined;
}

export function parseClientAnswerContext(text?: string | null): string | null {
  const value = (text || '').trim().replace(/^["'\u201c]|["'\u201d.!]+$/g, '');
  const clause = RELATIONSHIP_CLAUSE.exec(value);
  if (!clause || !parseClientNameAnswer(value)) return null;
  return value.slice(clause.index + clause[0].length).trim() || null;
}
