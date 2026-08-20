// ============================================================
// The gaps that are arithmetic, not judgement.
//
// Four of the six gap kinds are questions about SHAPE — did an
// outbound message follow this inbound one, is there a deal, is
// anything on the calendar — and shape needs no model. Running them
// first means a quiet account with fifty threads and nothing wrong
// costs zero AI calls and still gets a correct empty digest.
//
// The two that genuinely need language — was a promise made, and what
// did this thread say about the buyer — are in analyze.ts and cost
// money. Keeping the split at "judgement or not" rather than at
// "cheap or not" is what stops the free tier from quietly growing a
// keyword list that has to be maintained.
//
// Every function here is pure. A detector that reached the database
// could not be argued with.
// ============================================================

import type {
  DetectedGap,
  SweepMessage,
  SweepThread,
  ThreadContext,
} from './types';

/** A client question left hanging this long by the end of the window
 *  is a dropped ball rather than a thread still in flight. Four hours
 *  clears a lunch and a site visit; it does not clear a night. */
const UNANSWERED_HOURS = 4;

/** Below this an "unanswered question" is one message into a brand-new
 *  enquiry, which the enquiry flows already chase. */
const MIN_THREAD_FOR_NEXT_STEP = 4;

/** A bot line an agent overrode within this long was a takeover, not a
 *  coincidence of timing. */
const HANDOFF_MINUTES = 15;

const HOUR_MS = 3_600_000;

/**
 * Does this read as a question?
 *
 * A question mark is the reliable half. The word list is not there to
 * be exhaustive — it is there because WhatsApp Hindi-English drops
 * the mark constantly ("price kitna hai", "possession when") and a
 * mark-only test would miss most of what a client actually asks.
 * False positives cost a digest line; false negatives cost the answer.
 */
export function looksLikeQuestion(text: string): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (clean.includes('?')) return true;
  return /\b(what|when|where|which|why|how|who|can you|could you|is it|are you|do you|does it|any chance|available|kitna|kitne|kaha|kab|kaise|kaun|hai kya|please (send|share|confirm))\b/i.test(
    clean
  );
}

function lastOf<T>(list: T[]): T | undefined {
  return list.length ? list[list.length - 1] : undefined;
}

function quote(message: SweepMessage): string {
  return (message.text || `[${message.contentType}]`)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The line to show a reviewer, preferring something the CLIENT said.
 *
 * "The last message with text" is almost always our own outbound
 * template, because that is how these threads end. The first production
 * run proved how useless that is: a gap reading "Jyoti has told us what
 * they want and has been sent nothing" was evidenced by our own
 * property-update digest, which says nothing about Jyoti and argues
 * against the gap. A gap is judged on its quote, so the quote has to be
 * the other person.
 *
 * Falls back to the newest line of any kind when the client has said
 * nothing — an outbound-only thread still deserves its evidence.
 */
function evidenceFor(thread: SweepThread): SweepMessage | undefined {
  const spoken = thread.messages.filter((m) => (m.text || '').trim());
  const fromClient = spoken.filter((m) => m.speaker === 'customer');
  return lastOf(fromClient) ?? lastOf(spoken);
}

/**
 * A client question with no outbound message after it.
 *
 * Scans back from the end for the newest client line rather than
 * testing only the very last message: a client who asks the price and
 * then sends "thanks" has still not been answered, and a
 * last-message-only test would call that thread closed.
 */
export function detectUnansweredQuestion(
  thread: SweepThread,
  ctx: ThreadContext,
  windowEnd: Date
): DetectedGap | null {
  // Outbound-only by construction — there is no client line to strand.
  if (thread.channel === 'personal_whatsapp') return null;
  if (ctx.repliedAfterWindow) return null;

  const lastOutbound = lastOf(
    thread.messages.filter((m) => m.speaker === 'agent' || m.speaker === 'bot')
  );
  const outboundAt = lastOutbound ? Date.parse(lastOutbound.createdAt) : 0;

  const stranded = thread.messages
    .filter((m) => m.speaker === 'customer')
    .filter((m) => Date.parse(m.createdAt) > outboundAt)
    .filter((m) => looksLikeQuestion(m.text));

  const question = stranded[0];
  if (!question) return null;

  const idleHours =
    (windowEnd.getTime() - Date.parse(question.createdAt)) / HOUR_MS;
  if (idleHours < UNANSWERED_HOURS) return null;

  const who = thread.contactName || 'This client';
  return {
    kind: 'unanswered_question',
    // A question that sat overnight is a different order of problem
    // from one that sat through an afternoon.
    severity: idleHours >= 12 ? 'high' : 'medium',
    summary: `${who} asked something ${Math.round(idleHours)}h ago and got no reply`,
    evidence: quote(question),
    suggestedAction: 'Answer the question, or hand the thread to whoever can.',
    occurredAt: question.createdAt,
    propertyId: thread.propertyId,
  };
}

/**
 * A worked conversation that ended with nothing scheduled.
 *
 * The bar is deliberately high — a real back-and-forth, no deal, no
 * appointment, no to-do — because "nothing scheduled" is the normal
 * state of most threads on most days and a looser test would fill the
 * digest with conversations that are fine.
 */
/**
 * A live conversation that nothing is carrying forward.
 *
 * This was two detectors — `no_deal` ("being worked, on no pipeline")
 * and `missing_next_step` ("nothing scheduled") — and on the first
 * production run they fired on the same four contacts and produced
 * eight of ten gaps between them. They were never really two
 * questions: both ask whether anything at all is going to move this
 * conversation, and a reviewer reading two cards about one contact
 * learns nothing the first card did not already say.
 *
 * So it is one gap, and the distinction that was worth keeping — HOW
 * exposed the thread is — became the severity and the sentence rather
 * than a second row.
 *
 * One case is deliberately no longer raised: a contact on no pipeline
 * who nevertheless has a site visit booked. The old `no_deal` flagged
 * them, because it only looked at deals. A booked visit is somebody
 * carrying the thread forward, pipeline row or not, and that is the
 * question being asked here.
 */
export function detectUntrackedConversation(
  thread: SweepThread,
  ctx: ThreadContext
): DetectedGap | null {
  // Something already holds the next action.
  if (ctx.hasFutureAppointment || ctx.hasOpenTodo) return null;

  const spoken = thread.messages.filter((m) => (m.text || '').trim());
  if (spoken.length < MIN_THREAD_FOR_NEXT_STEP) return null;
  // Somebody has to have been talking back. A run of outbound
  // broadcasts is not a conversation anyone dropped.
  if (
    thread.channel === 'client' &&
    !spoken.some((m) => m.speaker === 'customer')
  ) {
    return null;
  }

  const last = evidenceFor(thread);
  if (!last) return null;

  const who = thread.contactName || 'This client';

  // Worst first: a buyer who has said what they want, is on no
  // pipeline and has nothing booked is invisible to everyone. An open
  // deal is at least somebody's job already.
  const exposed = !ctx.hasOpenDeal && ctx.hasStatedRequirement;

  const summary = ctx.hasOpenDeal
    ? `${who} has an open deal with nothing scheduled next`
    : exposed
      ? `${who} is being worked, on no pipeline and with nothing scheduled`
      : `${who} has an active thread with nothing scheduled next`;

  const suggestedAction = ctx.hasOpenDeal
    ? 'Book the next step on the deal, or set a follow-up task.'
    : exposed
      ? 'Add them to a pipeline and book a call or site visit.'
      : 'Book a call or a site visit, or set a follow-up task.';

  return {
    kind: 'untracked_conversation',
    severity: exposed ? 'medium' : ctx.hasOpenDeal ? 'medium' : 'low',
    summary,
    evidence: quote(last),
    suggestedAction,
    occurredAt: last.createdAt,
    propertyId: thread.propertyId,
  };
}

/**
 * The bot answered and an agent immediately said it differently.
 *
 * This is the only quality signal available without asking a model to
 * grade its own colleague: the agent's override IS the grade. What it
 * cannot tell is WHY, which is why the gap asks a human to look
 * rather than proposing a change to the bot.
 */
export function detectBotHandoff(thread: SweepThread): DetectedGap | null {
  const messages = thread.messages;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].speaker !== 'bot') continue;
    const next = messages[i + 1];
    if (next.speaker !== 'agent') continue;
    const gapMinutes =
      (Date.parse(next.createdAt) - Date.parse(messages[i].createdAt)) / 60_000;
    if (gapMinutes < 0 || gapMinutes > HANDOFF_MINUTES) continue;

    const who = thread.contactName || 'a client';
    return {
      kind: 'bot_handoff',
      severity: 'low',
      summary: `An agent stepped in over the bot with ${who}`,
      evidence: `BOT: ${quote(messages[i])}\nAGENT: ${quote(next)}`,
      suggestedAction:
        'Check whether the bot should have known this — it may be a missing listing fact or funnel answer.',
      occurredAt: next.createdAt,
      propertyId: thread.propertyId,
    };
  }
  return null;
}

/** A stated requirement that has never had a single listing sent
 *  against it. The matching engine exists; nobody ran it. */
export function detectUnmatchedRequirement(
  thread: SweepThread,
  ctx: ThreadContext
): DetectedGap | null {
  if (!ctx.hasStatedRequirement || ctx.hasSharedAnyProperty) return null;

  const last = evidenceFor(thread);
  if (!last) return null;

  const who = thread.contactName || 'This client';
  return {
    kind: 'unmatched_requirement',
    severity: 'high',
    summary: `${who} has told us what they want and has been sent nothing`,
    evidence: quote(last),
    suggestedAction: 'Run matching on this contact and share the shortlist.',
    occurredAt: last.createdAt,
    propertyId: null,
  };
}

/**
 * Every free detector, worst first.
 *
 * Capped at three per thread on purpose. A neglected conversation
 * trips all five at once, and five lines about one contact in a
 * digest is how a digest stops being read — the top few say the same
 * thing anyway.
 */
export function detectGaps(
  thread: SweepThread,
  ctx: ThreadContext,
  windowEnd: Date
): DetectedGap[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const found = [
    detectUnansweredQuestion(thread, ctx, windowEnd),
    detectUnmatchedRequirement(thread, ctx),
    detectUntrackedConversation(thread, ctx),
    detectBotHandoff(thread),
  ].filter((g): g is DetectedGap => g !== null);

  return found.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 3);
}
