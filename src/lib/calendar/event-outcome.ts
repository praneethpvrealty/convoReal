// ============================================================
// "This is already done. Hari has visited."
//
// An agent quote-replying a reminder to say the thing happened. The
// scheduling editor could only ever move an event — reschedule it,
// retitle it, change its location — so a reply reporting the OUTCOME
// parsed as intent 'none' and fell through to the intake classifier,
// which answered "🤔 I couldn't tell what that was." The event stayed
// 'scheduled' forever and the agent's account of it stayed in a chat
// bubble.
//
// Deliberately deterministic and free. The status is a small closed
// set of phrasings, and the outcome text is the agent's own sentence —
// asking a model to paraphrase "Hari has visited and now he will get
// back on the owners meeting etc" would cost a call to produce
// something worse than what was typed.
// ============================================================

export type EventOutcomeStatus = 'completed' | 'cancelled';

export interface ParsedEventOutcome {
  status: EventOutcomeStatus;
  /** The agent's own words, kept verbatim for appointments.outcome. */
  outcome: string;
}

/** It happened. */
const COMPLETED_SIGNAL =
  /\b(already (done|over|happened|visited|completed)|(is|was|has been|got) (done|completed|finished)|has visited|have visited|visited (the|him|her|them|it)|went (well|ahead|through|fine|ok|okay)|wrapped up|finished|completed it|met (him|her|them|the)|call (is )?done|site visit done|closed this)\b/i;

/**
 * The whole reply is the word. On a quote-reply to one event card a
 * bare "Done" is unambiguous, and it is the shortest thing an agent
 * walking back to their car will type — but only as the entire
 * message: "done" inside a sentence needs the fuller patterns above,
 * or "can you get this done by 4" closes the meeting it is asking about.
 */
const STANDALONE_COMPLETED = /^(yes[, ]+)?(all |its |it'?s )?(done|completed|finished|over|visited)[\s.!👍✅]*$/i;

/** It is not happening. */
const CANCELLED_SIGNAL =
  /\b(cancel(led|ed)?( this| it| the visit| the meeting)?|called off|didn'?t happen|did not happen|not happening|no[- ]?show|didn'?t turn up|did not turn up|dropped (this|it)|scrap(ped)? (this|it))\b/i;

/**
 * A reply that moves the event rather than closing it. "Postponed to
 * Monday" and "shift it to 4pm" are reschedules — the existing editor
 * owns those, and reading them as a cancellation would delete a
 * meeting that is still very much on.
 */
const RESCHEDULE_SIGNAL =
  /\b(reschedul\w*|postpon\w*|push(ed)? (it|this|to|back)|move (it|this|to)|shift(ed)? (it|this|to)|instead of|change (it|the) (time|date)|tomorrow|next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}\s*(am|pm)\b)/i;

/**
 * Reads a quote-reply as a report on how the event went.
 *
 * Returns null for anything that is not one — including a reschedule,
 * which looks superficially similar and must keep going to the editor.
 * Null is the safe answer: it leaves today's behaviour untouched.
 */
export function parseEventOutcome(
  text: string | null | undefined
): ParsedEventOutcome | null {
  const clean = (text || '').trim();
  if (!clean) return null;

  // A reschedule wins outright. "Postponed, the earlier one didn't
  // happen" is a move with an explanation attached, not a cancellation.
  if (RESCHEDULE_SIGNAL.test(clean)) return null;

  const cancelled = CANCELLED_SIGNAL.test(clean);
  const completed =
    COMPLETED_SIGNAL.test(clean) || STANDALONE_COMPLETED.test(clean);
  if (!cancelled && !completed) return null;

  // Both firing means the sentence is doing something more complicated
  // than either verb suggests ("the visit is done but the survey was
  // cancelled") — leave that to a human rather than guessing which
  // half is about this event.
  if (cancelled && completed) return null;

  return { status: cancelled ? 'cancelled' : 'completed', outcome: clean };
}
