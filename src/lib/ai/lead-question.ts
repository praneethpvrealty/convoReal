// ============================================================
// A lead's question on WhatsApp, answered the same way the public
// showcase answers one — and handed to a human when it can't be.
//
// The showcase has had this ladder for a while (/api/public/ask):
// deterministic answer from the listing's own fields first, Gemini
// grounded in those fields second. On WhatsApp the same buyer got
// nothing: "Can we see inside when we visit tomorrow" was read as a
// booking and re-acknowledged a visit that was already in the diary,
// and "which one is the one we are talking here" fell through to a
// keyword and restarted the welcome funnel.
//
// The ladder here is the showcase's, plus the rung it always needed:
// when neither tier can answer, say so honestly and put the question
// in front of an agent rather than guessing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  answerFromPropertyData,
  buildPropertyContext,
  PROPERTY_QA_SYSTEM_PROMPT,
  type QaProperty,
} from '@/lib/showcase/property-qa';
import {
  isLocationGuarded,
  localityLabel,
} from '@/lib/inventory/location-guard';
import { PORTALS } from '@/lib/portals/post-kit';
import {
  findPortalDiscrepancies,
  portalFromQuestion,
  type PortalListingFigures,
  type ReconcilableProperty,
} from '@/lib/portals/listing-reconcile';
import { resolvePropertySubject } from '@/lib/learning/subject';
import { resolveShortlistReference } from '@/lib/ai/shortlist-reference';
import type { Property } from '@/types';
import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';

/** Same feature key and price the public Ask endpoint burns. */
const AI_FEATURE = 'chatbot_auto_reply' as const;

/** What the lead hears when nobody but a human can answer. Deliberately
 *  promises a person, not a time — the agent decides that. */
export const HANDOVER_TEXT =
  'Good question — let me check that with the team and come right back to you.';

export type LeadAnswerSource = 'listing' | 'ai' | 'handover';

export interface LeadAnswer {
  text: string;
  source: LeadAnswerSource;
  /** The matched deterministic intent, for logging. */
  intent?: string | null;
}

/** The listing fields the final-price rung reads. Not part of QaProperty:
 *  those are the fields the PUBLIC showcase answers from, and the
 *  seller's floor is not one of them. */
export type SellerPriceFields = Pick<
  Property,
  'seller_final_price' | 'seller_final_price_per_sqft' | 'area_sqft'
>;

/**
 * "It says 4000sqft in magicbricks. Is it the same one???"
 *
 * A buyer comparing our listing against the portal copy of it. The
 * honest answer needs both figures and no bluff about which is right —
 * we genuinely do not know until an agent checks the survey, so this
 * confirms the listing is the same one, names both numbers, and
 * promises the confirmation rather than guessing.
 *
 * Returns null when the named portal has no linked copy of this
 * listing, which leaves the ladder exactly as it was.
 */
export function answerFromPortalListing(
  question: string,
  property: ReconcilableProperty & { title?: string },
  listings: PortalListingFigures[]
): string | null {
  const portal = portalFromQuestion(question);
  if (!portal) return null;

  const listing = listings.find((l) => l.portal === portal);
  if (!listing) return null;

  const label = PORTALS[portal]?.label ?? portal;
  const drifts = findPortalDiscrepancies(property, [listing]);

  if (!drifts.length) {
    return `Yes — same property. Our ${label} listing carries the same details you're seeing there.`;
  }

  const lines = drifts.map((d) => {
    if (d.field === 'price') {
      return `• Price — ${label} shows ${inr(d.theirs)}, our records show ${inr(d.ours)}`;
    }
    if (d.field === 'bedrooms') {
      return `• Bedrooms — ${label} shows ${d.theirs}, our records show ${d.ours}`;
    }
    return `• Area — ${label} shows ${d.theirs.toLocaleString('en-IN')} sq.ft., our records show ${d.ours.toLocaleString('en-IN')} sq.ft.`;
  });

  return [
    `Yes, it's the same property — good catch, the two don't line up:`,
    '',
    ...lines,
    '',
    'Let me confirm which is correct and come straight back to you.',
  ].join('\n');
}

/**
 * A buyer asking whether there is room on the price. Mirrors the
 * ESCALATE_PATTERN clause in property-qa.ts that sends these questions
 * past the structured answers — the difference is that here we may
 * actually have the answer.
 */
const FINAL_PRICE_QUESTION =
  /\b(negotiab|negotiate|bargain|discount|best price|final price|last price|lowest|net price|come down|reduce|any room)/i;

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

/**
 * Answers "is this negotiable?" from what an agent already established
 * with the seller, when the account has chosen to quote it.
 *
 * This is the payoff of the learning loop: the figure lands here only
 * because a human approved a suggestion extracted from an agent's own
 * reply, so quoting it is repeating a decision the brokerage made, not
 * a number the model inferred. Returns null when nothing is stored, and
 * the ladder carries on to the AI path and then the handover exactly as
 * before.
 */
export function answerFromSellerFinalPrice(
  question: string,
  property: SellerPriceFields
): string | null {
  if (!FINAL_PRICE_QUESTION.test(question || '')) return null;

  const rate = property.seller_final_price_per_sqft;
  const total = property.seller_final_price;

  if (rate) {
    const derived =
      property.area_sqft && property.area_sqft > 0
        ? ` — about ${inr(Math.round(rate * property.area_sqft))} for this unit`
        : '';
    return `There is a little room: the seller's final rate is ${inr(rate)} per sq.ft.${derived}. Shall I put you in touch with the team to close it?`;
  }

  if (total) {
    return `There is a little room: the seller's final price is ${inr(total)}. Shall I put you in touch with the team to close it?`;
  }

  return null;
}

/**
 * Is this text a question rather than an instruction?
 *
 * Used to keep question-shaped sentences out of the scheduling parser:
 * "can we see inside when we visit tomorrow" mentions tomorrow, but it
 * asks about access, it does not ask for a slot. Kept deliberately
 * conservative — an outright "book"/"schedule"/"remind me" is an
 * instruction even when phrased as a question ("can you schedule...").
 */
export function looksLikeQuestion(text: string | null | undefined): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(book|schedule|remind me|set up|arrange)\b/.test(t)) return false;
  if (t.includes('?')) return true;
  return /^(can|could|will|would|is|are|do|does|did|what|when|where|which|who|whom|why|how|any|shall|may)\b/.test(
    t
  );
}

/** What a lead hears when they ask for a person. Same promise as
 *  HANDOVER_TEXT and the same obligation: only the handover branch may
 *  send it, because that is what tells an agent to make the call. */
export const CALLBACK_HANDOVER_TEXT =
  "Of course — I'll have someone from the team call you shortly.";

/**
 * "Call me" — a lead asking for a person rather than answering us.
 *
 * It is not a question, so looksLikeQuestion misses it, and it carries
 * no property type or budget, so the qualification ladder should never
 * have claimed it either. Left unrouted it was answered with the next
 * rung of the ladder: a buyer who asked to be phoned got "what budget
 * range are you working with?".
 *
 * Deterministic, and matched on the lead's own words rather than an
 * intent call — this decides whether a human is summoned, which is too
 * important to make a paid call for and too cheap to need one.
 *
 * "I'll call you" is not a match and must not become one: the lead
 * saying they will ring is not a request for us to.
 */
export function requestsHumanContact(text?: string | null): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  return /\b(call me|call back|call-back|callback|give me a (call|ring)|ring me|phone me|(please|pls|plz) call|(talk|speak) (to|with) (a |an )?(human|person|someone|somebody|agent|executive|team)|connect me)\b/.test(
    t
  );
}

export type SubjectProperty = QaProperty & SellerPriceFields & { id: string };

/**
 * One message out of one answer per listing the buyer numbered.
 *
 * Headed by the listing's title, because "Koramangala 5th block" and
 * "JP Nagar 4th Phase" one after the other say nothing about which is
 * option 1. Identical answers collapse to one — asking to be called
 * about two listings is still one callback, and repeating the promise
 * makes it sound automated, which is exactly what it must not sound
 * like at the moment a person is being summoned.
 */
export function mergeLeadAnswers(
  answers: LeadAnswer[],
  subjects: { title?: string | null }[]
): LeadAnswer {
  const first = answers[0] ?? {
    text: HANDOVER_TEXT,
    source: 'handover' as const,
  };
  if (answers.length < 2) return first;
  if (new Set(answers.map((a) => a.text.trim())).size === 1) return first;

  return {
    text: answers
      .map((answer, i) => {
        const title = subjects[i]?.title?.trim();
        return title ? `*${title}*\n${answer.text}` : answer.text;
      })
      .join('\n\n'),
    // Any listing we could not answer for still owes the buyer a
    // person, and the handover branch is what summons one.
    source: answers.some((a) => a.source === 'handover')
      ? 'handover'
      : first.source,
    intent: answers.every((a) => a.intent === first.intent)
      ? first.intent
      : null,
  };
}

async function loadSubjects(
  db: SupabaseClient,
  accountId: string,
  ids: string[]
): Promise<SubjectProperty[]> {
  if (ids.length === 0) return [];
  const { data } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .in('id', ids);

  const rows = (data ?? []) as SubjectProperty[];
  // Back in the order the buyer named them, so "1 and 2" is answered
  // as 1 then 2.
  return ids
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is SubjectProperty => !!row);
}

/**
 * The listings a question is about.
 *
 * Numbers the buyer used win, because they are the most explicit thing
 * anyone in the thread has said about which listing is meant — the bot
 * numbered the shortlist and invited exactly this. Failing that it is
 * the shared subject resolver: the share ledger reconciled against what
 * the agent has since said.
 *
 * Empty means the thread cannot be pinned to a listing, which the
 * caller reads as a handover: a buyer told "let me check and come back"
 * loses nothing, where a buyer told the wrong listing's facts cannot
 * tell.
 */
export async function questionSubjectProperties(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null,
  /** The buyer's own words, read for "option 2" / "the first one". */
  questionText?: string | null
): Promise<SubjectProperty[]> {
  if (conversationId && questionText) {
    const numbered = await resolveShortlistReference(
      db,
      accountId,
      conversationId,
      questionText
    );
    if (numbered.length > 0) return loadSubjects(db, accountId, numbered);
  }

  const propertyId = await resolvePropertySubject(
    db,
    accountId,
    contactId,
    conversationId
  );
  return propertyId ? loadSubjects(db, accountId, [propertyId]) : [];
}

/** The single listing a question is about, for callers that answer one. */
export async function questionSubjectProperty(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null,
  questionText?: string | null
): Promise<SubjectProperty | null> {
  const subjects = await questionSubjectProperties(
    db,
    accountId,
    contactId,
    conversationId,
    questionText
  );
  return subjects[0] ?? null;
}

/** Portal statuses that mean this row describes THIS property. A
 *  'review' or 'new' item is an unresolved guess — quoting its figures
 *  to a buyer would assert a link nobody has confirmed. */
const LINKED_PORTAL_STATUSES = ['linked', 'auto_matched', 'imported'];

/**
 * The harvested portal copies of one listing. Empty for an account
 * that has never run a portal sync, which is the pre-existing
 * behaviour: no rows, no portal rung, ladder unchanged.
 */
export async function subjectPortalListings(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<PortalListingFigures[]> {
  const { data } = await db
    .from('portal_import_items')
    .select('portal, listing_url, price, area_sqft, bedrooms')
    .eq('account_id', accountId)
    .eq('matched_property_id', propertyId)
    .in('match_status', LINKED_PORTAL_STATUSES);

  return (data ?? []).map((row) => ({
    portal: row.portal as PortalListingFigures['portal'],
    listingUrl: row.listing_url,
    price: row.price,
    areaSqft: row.area_sqft,
    bedrooms: row.bedrooms,
  }));
}

/**
 * Walk the ladder. Never throws and never returns an empty string: the
 * worst case is the handover line, which is a real answer to the lead
 * even though it defers the substance to a person.
 *
 * A guarded listing is answered from its locality-substituted row, so
 * the Q&A can never leak an address the showcase itself withholds.
 */
export async function answerLeadQuestion(args: {
  accountId: string;
  question: string;
  property:
    | (QaProperty & Partial<SellerPriceFields> & Partial<ReconcilableProperty>)
    | null;
  /** whatsapp_config.share_seller_final_price. Off by default: a
   *  seller's floor is the brokerage's to quote, not the bot's to
   *  volunteer, and the account decides when it is. */
  shareSellerFinalPrice?: boolean;
  /** This listing's harvested portal copies, for a buyer comparing us
   *  against MagicBricks / 99acres / Housing. */
  portalListings?: PortalListingFigures[];
}): Promise<LeadAnswer> {
  const { accountId, question, property } = args;
  // Before the listing check: a lead asking to be called is asking for
  // a person, not for a fact about a listing, so this must answer even
  // when no listing can be pinned to the thread.
  if (requestsHumanContact(question)) {
    return { text: CALLBACK_HANDOVER_TEXT, source: 'handover' };
  }
  if (!property) return { text: HANDOVER_TEXT, source: 'handover' };

  const guarded = isLocationGuarded(property);
  const qaProperty = guarded
    ? { ...property, location: localityLabel(property) }
    : property;

  // First rung of all: a buyer naming a portal is asking about a
  // specific document we hold, and the generic matchers below have no
  // idea it exists — property-qa would send "is it the same one?" to
  // the model, which grounds only on our own fields and can do nothing
  // but deny knowledge of MagicBricks.
  if (args.portalListings?.length) {
    const portalAnswer = answerFromPortalListing(
      question,
      property,
      args.portalListings
    );
    if (portalAnswer) {
      return {
        text: portalAnswer,
        source: 'listing',
        intent: 'portal_compare',
      };
    }
  }

  // Ahead of the structured matchers: property-qa deliberately refuses
  // price-negotiability questions, and it is right to — it answers the
  // public showcase too, where this figure must never appear.
  if (args.shareSellerFinalPrice) {
    const finalPrice = answerFromSellerFinalPrice(question, property);
    if (finalPrice) {
      return {
        text: finalPrice,
        source: 'listing',
        intent: 'seller_final_price',
      };
    }
  }

  const structured = answerFromPropertyData(question, qaProperty);
  if (structured.answer) {
    const text =
      guarded && structured.intent === 'location'
        ? `${structured.answer} The exact address is shared on request.`
        : structured.answer;
    return { text, source: 'listing', intent: structured.intent };
  }

  // Soft burn before the call: an account out of credits hands over to
  // a human rather than failing, and never pays for a call we skip.
  try {
    const burn = await burnCredits(
      accountId,
      AI_FEATURE,
      AI_FEATURE_COSTS[AI_FEATURE],
      {
        hardBlock: false,
      }
    );
    if (burn.deficit !== 0) return { text: HANDOVER_TEXT, source: 'handover' };
  } catch (err) {
    console.error('[lead-question] credit burn failed:', err);
    return { text: HANDOVER_TEXT, source: 'handover' };
  }

  try {
    const prompt = `Property details:\n${buildPropertyContext(qaProperty)}\n\nBuyer's question: ${question}\n\nAnswer:`;
    const raw = await generateText(prompt, PROPERTY_QA_SYSTEM_PROMPT, {
      feature: AI_FEATURE,
    });
    const answer = (raw || '').trim();
    // The system prompt tells Gemini to refuse rather than invent. A
    // refusal is a handover, not an answer.
    if (!answer || isNonAnswer(answer)) {
      return { text: HANDOVER_TEXT, source: 'handover' };
    }
    return { text: answer, source: 'ai' };
  } catch (err) {
    console.error('[lead-question] AI answer failed:', err);
    return { text: HANDOVER_TEXT, source: 'handover' };
  }
}

/**
 * Gemini saying "I don't know" in the shapes the prompt invites.
 *
 * Since the prompt started asking for a first-person deferral instead
 * of a flat refusal, "let me confirm that and come back to you" is what
 * a non-answer now looks like. It reads like an answer and is not one —
 * missing it would return source 'ai', and the handover branch is what
 * notifies an agent and pings the reply bridge. A buyer promised a
 * callback by a bot nobody was told about is worse than no reply.
 */
function isNonAnswer(answer: string): boolean {
  const text = answer.trim();
  if (
    /^(i (don'?t|do not) (know|have)|sorry[, ]|that information (is|isn'?t)|not (specified|available|mentioned)|no information)/i.test(
      text
    )
  ) {
    return true;
  }
  return /\b(let me (confirm|check|find out|verify)|i'?ll (confirm|check|find out|verify|get back)|come (right )?back to you|check (on )?(that|this) and revert|revert (on|to) you)\b/i.test(
    text
  );
}
