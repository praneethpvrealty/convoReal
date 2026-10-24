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
  asksToIdentifyInPhoto,
  availabilityAnswer,
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
  asksListingAttribute,
  disputesSharedListing,
} from '@/lib/ai/requirement-signal';
import { unavailableListingReply } from '@/lib/inventory/listing-status';
import {
  findPortalDiscrepancies,
  portalFromQuestion,
  type PortalListingFigures,
  type ReconcilableProperty,
} from '@/lib/portals/listing-reconcile';
import {
  decideSubjects,
  loadSubjectThread,
  quotesListing,
  shareEvents,
  type InboundSubjectContext,
} from '@/lib/learning/subject';
import {
  parseOrdinalReferences,
  resolveShortlistReference,
} from '@/lib/ai/shortlist-reference';
import {
  describedListingAmong,
  type DescribedCandidate,
} from '@/lib/ai/described-listing';
import type { Property } from '@/types';
import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  botInstructionPrompt,
  type BotInstructionMatch,
} from '@/lib/ai/bot-instructions';

/** Same feature key and price the public Ask endpoint burns. */
const AI_FEATURE = 'chatbot_auto_reply' as const;

const INDIAN_SCRIPT_PATTERN = /[\u0900-\u0D7F]/u;

/** What the lead hears when nobody but a human can answer. Deliberately
 *  promises a person, not a time — the agent decides that. */
export const HANDOVER_TEXT =
  'Good question — let me check that with the team and come right back to you.';

/** What the lead hears when they ask us to point at something in the
 *  photo. Only someone who has stood on the site can answer it, so it
 *  is a handover with the same obligations as HANDOVER_TEXT. */
export const PHOTO_IDENTIFICATION_HANDOVER_TEXT =
  "Good question — I'll confirm exactly which one it is in the photo with the team and come right back to you.";

/** What the lead hears when they dispute a fact about the listing —
 *  "it doesn't seem to be a 30x50 plot". The listing's own record is
 *  the thing in question, so only a person can settle it; same
 *  obligations as HANDOVER_TEXT. */
export const LISTING_DISPUTE_HANDOVER_TEXT =
  "Thanks for flagging that — I'll have the team verify this listing's details and come right back to you.";

export function isHandoverText(text: string | null | undefined): boolean {
  const t = text ?? '';
  return [
    HANDOVER_TEXT,
    PHOTO_IDENTIFICATION_HANDOVER_TEXT,
    LISTING_DISPUTE_HANDOVER_TEXT,
    CALLBACK_HANDOVER_TEXT,
    CONTACT_NUMBER_HANDOVER_PREFIX,
  ].some((line) => t.includes(line));
}

export type LeadAnswerSource = 'listing' | 'ai' | 'handover';

export interface LeadAnswer {
  text: string;
  source: LeadAnswerSource;
  /** The matched deterministic intent, for logging. */
  intent?: string | null;
  appliedInstructionIds?: string[];
}

function requiresEnglishReply(question: string): boolean {
  return /[A-Za-z]/.test(question) && !INDIAN_SCRIPT_PATTERN.test(question);
}

function replyMatchesQuestionLanguage(
  question: string,
  answer: string
): boolean {
  return !requiresEnglishReply(question) || !INDIAN_SCRIPT_PATTERN.test(answer);
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
// "Hi ji\nWhich old building" opens with a greeting and asks on the
// next line; "if I get a buyer, will I get commission" asks after a
// comma. Both were read as statements and left unanswered for days.
// An honorific is stripped only when punctuation sets it apart: "Sir,
// is it available" asks; "Sir will call you in the evening" reports.
const GREETING_PREFIX =
  /^(?:(?:hi+|hello|hey|helo|namaste|namaskara|namaskar|vanakkam|good (?:morning|afternoon|evening|day)|dear)[\s,.!]*|(?:sir|madam|ma'am|mam|ji|bro|boss|team)[,.!]+\s*)+/;
const QUESTION_OPENER =
  /^(can|could|will|would|is|are|do|does|did|what|when|where|which|who|whom|why|how|any|shall|may)\b/;
// After a greeting a modal needs a subject: "Hi, will call you in the
// evening" reports, "Hi, will you be there" asks.
const QUESTION_AFTER_GREETING =
  /^(?:what|when|where|which|who|whom|why|how)\b|^(?:is|are|was|were|can|could|will|would|shall|should|do|does|did|may|any)\s+(?:i|we|you|u|it|this|that|there|the|these|those|they|he|she)\b/;
const MID_CLAUSE_QUESTION =
  /[,;]\s*(?:will|would|can|could|shall|should|do|does|did|is|are|am|may)\s+(?:i|we|you|u)\b/;

export function looksLikeQuestion(text: string | null | undefined): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(book|schedule|remind me|set up|arrange)\b/.test(t)) return false;
  if (t.includes('?')) return true;
  if (MID_CLAUSE_QUESTION.test(t)) return true;
  // Only the opening line may ask with a bare modal; "Noted sir / Will
  // call you in the evening" reports on its second line.
  const body = t.replace(GREETING_PREFIX, '').trim();
  const firstOpener = body === t ? QUESTION_OPENER : QUESTION_AFTER_GREETING;
  return body.split('\n').some((line, index) => {
    const stripped = line.replace(GREETING_PREFIX, '').trim();
    return index === 0
      ? firstOpener.test(stripped)
      : QUESTION_AFTER_GREETING.test(stripped);
  });
}

/** What a lead hears when they ask for a person. Same promise as
 *  HANDOVER_TEXT and the same obligation: only the handover branch may
 *  send it, because that is what tells an agent to make the call. */
export const CALLBACK_HANDOVER_TEXT =
  "Of course — I'll have someone from the team call you shortly.";

/** A lead who asked for OUR number gets it when the account has one
 *  (showcase_settings.contact_phone), and the same callback promise
 *  after it, so a person still hears about them. The fixed opening is
 *  what isHandoverText keys on, since the number varies by account. */
export const CONTACT_NUMBER_HANDOVER_PREFIX =
  'Of course — you can reach the team on ';

export function contactNumberHandoverText(phone: string): string {
  return `${CONTACT_NUMBER_HANDOVER_PREFIX}${phone.trim()}. I'll also have someone call you shortly.`;
}

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
 * Read clause by clause. "I'll call you" and "I'll call back tomorrow"
 * are the lead offering to ring us, not asking us to, so that offer is
 * struck out first. A request is refused only when the negation governs
 * it ("please don't ever call me", "I don't want to talk to an agent");
 * "I don't know, please call me" and "don't hesitate to call me" still
 * ask for a person.
 */
const CLAUSE_BREAK = /[.,;:!?\n]+|\b(?:but|so)\b/;

const OWN_SUBJECT =
  /^(?:(?:i|we)(?:'ll|'d| will| shall| would| could| can| may| might| should| must)|(?:i'm|we're|i am|we are) going to|let me|let us|lemme)\b/;

const BARE_CALL =
  /^(?:(?:also|then|just) )?(?:call|ring|phone|give (?:you )?a (?:call|ring))\b(?! me\b)/;

const OWN_CALL_OFFER =
  /\b(?:(?:i|we)(?:'ll|'d|'m|'re| will| shall| would| could| can| may| might| should| must| am| are)?(?: (?:definitely|probably|surely|certainly|just|also|maybe|then|soon|myself|personally|really|quickly|ourselves))?(?: going to| gonna| try to| plan to| want to| need to| have to)?(?: (?:definitely|probably|surely|certainly|just|also|maybe|then|soon|myself|personally|really|quickly|ourselves))?|let me|let us|lemme) (?:give (?:you )?a )?(?:call|ring|phone)(?: you)?(?: back)?\b/g;

const HUMAN_REQUEST =
  /\b(call me|call back|call-back|callback|give me a (call|ring)|ring me|phone me|(please|pls|plz) call|(talk(?:ing)?|speak(?:ing)?) (to|with) (a |an |the )?(human|person|someone|somebody|agent|executive|team|owner|seller)|connect me)\b/g;

/** "Can you arrange a meeting with the owner", "I want to meet the
 *  owner": a meeting is a request only after a request cue, or as a
 *  bare imperative opening the clause. "I had a discussion with the
 *  owner, he is ready at 1.8 cr" reports one and asks for nothing. */
const MEETING_VERB_REQUEST =
  /\bmeet (the |your )?(owner|seller|agent|builder|manager)\b/g;
const MEETING_NOUN_REQUEST =
  /\b(meeting|discussion|call) with (the |a |an |your )?(owner|seller|agent|team|builder|manager)\b/g;
const REQUEST_CUE_BEFORE_MEETING =
  /\b(?:want|need|wish|like|love|arrange|fix|set ?up|schedule|organi[sz]e|request|please|pls|plz|(?:can|could|may|shall|would|should) (?:i|we|you|u))(?: (?!(?:after|before|following|once|post)\b)\w+){0,3} $/;
// The bare imperative opens its clause only as a verb: "Meet the owner"
// asks, "Meeting with the owner done, he agreed" reports.
const MEETING_VERB_CUE = new RegExp(
  `^\\s*$|${REQUEST_CUE_BEFORE_MEETING.source}`
);

/** "I want to visit the site and meet the owner on Saturday at 11am"
 *  is a visit to book, not a call to promise: a meeting named with a
 *  visit, a day or a time stays with the scheduler. */
// The same day and time forms the scheduler reads (TIME_CUE and
// DATE_CUE in src/lib/calendar/whatsapp-scheduler.ts), kept here so
// this classifier stays free of that module's database and credit
// imports.
const VISIT_OR_TIME =
  /\b(?:visit|viewing|see the (?:site|property|house|plot|flat)|today|tomorrow|tonight|weekend|day after|(?:this|next|coming) (?:week|month|weekend|mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:mon|tues|wednes|thurs|fri|satur|sun)day|at \d{1,2}(?:[:.]\d{2}|\s?(?:am|pm))|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:on|by|before|after|from|till|until) \d{1,2}[\/-]\d{1,2})\b/;

/** "Call ?", "call pls", "phone": the whole message is the one word.
 *  Nothing names a subject, so the clause reader above sees neither a
 *  request nor an offer; the model then asked the lead for a number
 *  they were already writing from. */
const BARE_CALL_MESSAGE =
  /^(?:(?:pls|please|plz|kindly|sir|madam|hi|hello)[\s,]+)*(?:call|phone|ring|call ?back)(?:[\s,]+(?:pls|please|plz|sir|madam|me|back|now|today|tomorrow|asap|kindly))*\s*[?.!]*$/;

/** "Could you share me an appropriate number to discuss over a call",
 *  "what's your contact number", "whom should I call": a lead asking
 *  for OUR number is asking for a person as surely as "call me". Left
 *  unmatched on 17 October it was answered as a question about each of
 *  three listings, one of them by the model.
 *
 *  A bare "your number" is not a request — "thanks, I saved your
 *  contact number" acknowledges one — so a number phrase counts only
 *  when request language comes before it in the clause, and never when
 *  the number is the lead's own ("my alternate contact number is …"). */
const NUMBER_PHRASE =
  /\b(?:(?:your|ur) (?:(?:contact|phone|mobile|cell|whatsapp|office|direct|landline) )?(?:number|no|num)|(?<!\b(?:my|our|his|her|their)(?: \w+){0,2} )(?:contact|phone|mobile|cell|telephone|landline|office|direct) (?:number|no|num))\b/g;

const REQUEST_CUE =
  /\b(?:share|send|give|provide|pass|drop|forward|tell|need|want|looking for|what(?:'s| is|s)?|which|is there|any|please|pls|plz|(?:can|could|may|would|shall|should) (?:i|we|you|u))\b/;

/** "A number to call", "whom should I call": a request by its shape. */
const NUMBER_REQUEST =
  /\b(?:(?:number|no|num) (?:to|for) (?:call|calling|discuss|talk|speak|contact|reach|connect|coordinate)|whom (?:should|can|do|could|shall) (?:i|we) (?:call|contact|speak|talk|reach))\b/g;

/** "Can I call you", "can we discuss over a call", "I'd like to talk
 *  on a call": the lead asking to ring us now. OWN_CALL_OFFER would
 *  strike "I call" out as an offer, so this reads the raw clause, and
 *  it needs a modal or a wish so that "as discussed over a call, my
 *  budget is 2 cr" stays a requirement. */
const CALL_US_REQUEST =
  /\b(?:(?:can|could|may|shall) (?:i|we) (?:call|ring|phone)(?: you| u)?|(?:(?:can|could|may|shall|would|should) (?:i|we|you|u)|(?:i|we)(?:'d| would)(?: like| prefer| love)?|(?:i|we) (?:want|need|prefer|wish)|(?:let's|lets|let us)|(?:please|pls|plz))(?: \w+){0,2}? (?:to )?(?:discuss|talk|speak|connect|chat|explain)\w*(?: \w+){0,3}? (?:over|on) (?:a|an|the) (?:call|phone))\b/g;

const REFUSAL_GLUE = new Set([
  'a',
  'an',
  'the',
  'any',
  'for',
  'want',
  'wanna',
  'need',
  'you',
  'to',
  'ever',
  'really',
  'even',
  'have',
  'try',
  'trying',
  'tryna',
  'keep',
  'keeping',
  'get',
  'getting',
  'receive',
  'anyone',
  'anybody',
  'share',
  'send',
  'give',
  'provide',
  'your',
  'ur',
  'me',
  'us',
]);

const REFUSAL_WORDS = new Set([
  "don't",
  'dont',
  "didn't",
  'didnt',
  "won't",
  'wont',
  "can't",
  'cant',
  'cannot',
  "shouldn't",
  'shouldnt',
  "mustn't",
  'mustnt',
  'never',
  'stop',
]);

function normaliseCallText(text?: string | null): string {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

/** "I'll check and call back tomorrow": the second half keeps the
 *  first half's own-call subject, so it still reads as the lead's call.
 *  "I'm busy and call me later" does not: "I'm busy" promises nothing,
 *  and "call me" is addressed to us. */
function callClauses(text?: string | null): string[] {
  return normaliseCallText(text)
    .split(CLAUSE_BREAK)
    .flatMap((segment) => {
      const parts = segment
        .split(/\band\b/)
        .map((part) => part.trim())
        .filter(Boolean);
      const subject = parts[0]?.match(OWN_SUBJECT)?.[0];
      return parts.map((part, i) =>
        i > 0 && subject && BARE_CALL.test(part) ? `${subject} ${part}` : part
      );
    });
}

const CONTACT_VERBS = new Set([
  'call',
  'ring',
  'phone',
  'text',
  'message',
  'email',
  'contact',
  'connect',
  'whatsapp',
]);

function refusedBefore(prefix: string): boolean {
  const words = prefix.trim().split(' ').filter(Boolean);
  let end = words.length;
  while (end > 0) {
    const word = words[end - 1];
    if (REFUSAL_WORDS.has(word)) return true;
    if ((word === 'not' || word === 'no') && words[end - 2] !== 'why')
      return true;
    if (
      (word === 'or' || word === 'nor') &&
      end > 1 &&
      CONTACT_VERBS.has(words[end - 2])
    ) {
      end -= 2;
      continue;
    }
    if (!REFUSAL_GLUE.has(word)) return false;
    end -= 1;
  }
  return false;
}

/** The message with the lead's own offer to ring us struck out, so
 *  what is left can be read for any other request it carries. */
export function withoutOwnCallOffer(text?: string | null): string {
  return callClauses(text)
    .map((clause) => clause.replace(OWN_CALL_OFFER, ' ').trim())
    .filter(Boolean)
    .join(', ');
}

/** "I'll call back tomorrow" — the lead offering to ring us. */
export function offersOwnCall(text?: string | null): boolean {
  return callClauses(text).some((clause) =>
    new RegExp(OWN_CALL_OFFER.source).test(clause)
  );
}

function unrefusedMatch(
  text: string,
  pattern: RegExp,
  prefixMustMatch?: RegExp
): boolean {
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(0, match.index);
    if (prefixMustMatch && !prefixMustMatch.test(prefix)) continue;
    if (!refusedBefore(prefix)) return true;
  }
  return false;
}

/** The lead asking to reach us: for our number, or to call us now.
 *  Either one is answered with the number when the account has one. */
export function asksForContactNumber(text?: string | null): boolean {
  return callClauses(text).some(
    (clause) =>
      unrefusedMatch(
        clause.replace(OWN_CALL_OFFER, ' '),
        NUMBER_PHRASE,
        REQUEST_CUE
      ) ||
      unrefusedMatch(clause, NUMBER_REQUEST) ||
      unrefusedMatch(clause, CALL_US_REQUEST)
  );
}

export function requestsHumanContact(text?: string | null): boolean {
  return (
    BARE_CALL_MESSAGE.test(normaliseCallText(text).trim()) ||
    callClauses(text).some((clause) =>
      unrefusedMatch(clause.replace(OWN_CALL_OFFER, ' '), HUMAN_REQUEST)
    ) ||
    (!VISIT_OR_TIME.test(normaliseCallText(text)) &&
      callClauses(text).some(
        (clause) =>
          unrefusedMatch(clause, MEETING_VERB_REQUEST, MEETING_VERB_CUE) ||
          unrefusedMatch(
            clause,
            MEETING_NOUN_REQUEST,
            REQUEST_CUE_BEFORE_MEETING
          )
      )) ||
    asksForContactNumber(text)
  );
}

/**
 * Is this a reply to a conversation already under way, rather than a
 * message opening one? A question counts only once a listing has been
 * sent to this lead — that is the share ledger the Q&A answers from.
 */
export function repliesRatherThanOpens(
  text: string | null | undefined,
  options: { listingAlreadySent: boolean }
): boolean {
  if (requestsHumanContact(text)) return true;
  return (
    options.listingAlreadySent &&
    (looksLikeQuestion(text) ||
      asksListingAttribute(text) ||
      disputesSharedListing(text))
  );
}

export function quickReplyHumanRequest(message: {
  type?: string;
  button?: { text?: string | null } | null;
}): string | null {
  if (message.type !== 'button') return null;
  const label = message.button?.text?.trim();
  return label && requestsHumanContact(label) ? label : null;
}

export type SubjectProperty = QaProperty &
  SellerPriceFields & { id: string; is_published?: boolean | null };

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
    appliedInstructionIds: [
      ...new Set(
        answers.flatMap((answer) => answer.appliedInstructionIds ?? [])
      ),
    ],
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

/** Shares read back when a buyer describes one of them. A buyer points
 *  at something sent recently; six covers two shortlists. */
const DESCRIBED_LOOKBACK_SHARES = 6;

/**
 * The listing among the buyer's recent shares that their words describe
 * — "the 40,000 sqft one", "the Chikatogur plot" — or null when they
 * describe none, or more than one, of them. The shares are read from
 * the thread, not the ledger alone: a re-share does not bump its ledger
 * row, so the ledger's newest rows can miss the card sent a minute ago.
 */
/**
 * The listing the buyer's words describe, read against the cards the
 * question was about before the wider thread. On 7 October "No this
 * 40,000 sqft one" fitted two of the last six shares — the Chikatogur
 * plot and an earlier Hosur Road plot of the same size — and so named
 * nothing; against the two cards just sent it names the Chikatogur
 * plot alone.
 */
function describedSubject(
  text: string,
  candidates: DescribedCandidate[],
  batch: string[]
): string | null {
  if (batch.length > 1) {
    const within = describedListingAmong(
      text,
      candidates.filter((candidate) => batch.includes(candidate.id))
    );
    if (within) return within;
  }
  return describedListingAmong(text, candidates);
}

/**
 * The listings a question is about.
 *
 * Numbers the buyer used win, because they are the most explicit thing
 * anyone in the thread has said about which listing is meant — the bot
 * numbered the shortlist and invited exactly this. A quoted share comes
 * next: swiping to reply on a card is pointing at it, whatever the
 * words say. Then a description: a buyer who says "the 40,000 sqft one"
 * has named a listing as surely as by number. Failing all three it is
 * the shared subject resolver: a listing they just enquired about, an
 * agent's pitch, then the share ledger — every listing of a batch when
 * two were sent back to back, each answered under its title.
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
  /** The buyer's own words, read for "option 2" / "the 40,000 sqft one". */
  questionText?: string | null,
  inbound?: InboundSubjectContext
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

  const thread = await loadSubjectThread(
    db,
    accountId,
    contactId,
    conversationId,
    inbound
  );
  if (!thread) return [];

  const propertyIds = decideSubjects(thread);
  if (questionText && !quotesListing(thread)) {
    const recent = shareEvents(thread)
      .slice(0, DESCRIBED_LOOKBACK_SHARES)
      .map((event) => event.propertyId);
    const candidates: DescribedCandidate[] = thread.candidates.filter(
      (candidate) => recent.includes(candidate.id)
    );
    const described = describedSubject(questionText, candidates, propertyIds);
    if (described) return loadSubjects(db, accountId, [described]);
  }

  return propertyIds.length > 0 ? loadSubjects(db, accountId, propertyIds) : [];
}

/**
 * The question a buyer asked just before pointing at a listing.
 *
 * "Can u share the exact location?" answered from the wrong card, then
 * "No this 40,000 sqft one": the second message names the listing and
 * the first carries the question, and the buyer expects the two read
 * together. Only the message immediately before counts — a pointer sent
 * an hour after "ok" must not resurrect a question from earlier in the
 * thread — so this is null when that message is not a question, and
 * the current message is skipped whether or not it has been persisted
 * yet.
 */
export async function previousLeadQuestion(
  db: SupabaseClient,
  conversationId: string,
  currentText: string
): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2);

  const texts = (data ?? []).map((row) =>
    ((row.content_text as string) || '').trim()
  );
  const previous = texts[texts[0] === currentText.trim() ? 1 : 0];
  if (!previous) return null;
  return looksLikeQuestion(previous) &&
    !requestsHumanContact(previous) &&
    parseOrdinalReferences(previous).length === 0
    ? previous
    : null;
}

/** The single listing a question is about, for callers that answer one. */
export async function questionSubjectProperty(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId?: string | null,
  questionText?: string | null,
  inbound?: InboundSubjectContext
): Promise<SubjectProperty | null> {
  const subjects = await questionSubjectProperties(
    db,
    accountId,
    contactId,
    conversationId,
    questionText,
    inbound
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
  botInstructions?: BotInstructionMatch[];
  /** showcase_settings.contact_phone: the number a lead who asks for
   *  one is given. Unset or blank, they are promised a call instead. */
  contactPhone?: string | null;
  /** False for a dry run — the dev simulator — so the account is not
   *  charged for a preview. Live sends leave it unset. */
  chargeCredits?: boolean;
  /** The buyer has a saved requirement: an unavailable listing's
   *  availability answer offers to confirm it rather than ask again. */
  briefOnFile?: boolean;
}): Promise<LeadAnswer> {
  const { accountId, question, property } = args;
  // Before the listing check: a lead asking to be called is asking for
  // a person, not for a fact about a listing, so this must answer even
  // when no listing can be pinned to the thread.
  if (requestsHumanContact(question)) {
    const phone = args.contactPhone?.trim();
    return {
      text:
        phone && asksForContactNumber(question)
          ? contactNumberHandoverText(phone)
          : CALLBACK_HANDOVER_TEXT,
      source: 'handover',
    };
  }
  if (!property) return { text: HANDOVER_TEXT, source: 'handover' };
  // Before every rung and before any credit is spent: no field and no
  // model can say which house in the photo is the listing.
  if (asksToIdentifyInPhoto(question)) {
    return {
      text: PHOTO_IDENTIFICATION_HANDOVER_TEXT,
      source: 'handover',
      intent: 'photo_identification',
    };
  }

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

  // After the portal rung: "is the 99acres listing different from this
  // one?" is a comparison the portal data answers. Any other buyer
  // disputing what the record says is not asking the record.
  if (disputesSharedListing(question)) {
    return {
      text: LISTING_DISPUTE_HANDOVER_TEXT,
      source: 'handover',
      intent: 'listing_dispute',
    };
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

  const structured = answerFromPropertyData(question, qaProperty, {
    briefOnFile: args.briefOnFile,
  });
  // "What all are available" asks for other listings: the ladder sends
  // them when it runs; when it does not, a person does, never a model
  // grounded in the one listing the lead is asking past.
  // Asked about a listing that has left the market, the regret and
  // the brief playback (PRP-050) still answer it, as for "is it sold?".
  if (structured.intent === 'more_listings') {
    if (unavailableListingReply(null, qaProperty.title, qaProperty.status)) {
      return {
        text: availabilityAnswer(qaProperty, { briefOnFile: args.briefOnFile }),
        source: 'listing',
        intent: 'availability',
      };
    }
    return { text: HANDOVER_TEXT, source: 'handover', intent: 'more_listings' };
  }
  if (structured.answer) {
    const text =
      guarded && structured.intent === 'location'
        ? `${structured.answer} The exact address is shared on request.`
        : structured.answer;
    return { text, source: 'listing', intent: structured.intent };
  }

  // Soft burn before the call: an account out of credits hands over to
  // a human rather than failing, and never pays for a call we skip.
  if (args.chargeCredits !== false) {
    try {
      const burn = await burnCredits(
        accountId,
        AI_FEATURE,
        AI_FEATURE_COSTS[AI_FEATURE],
        {
          hardBlock: false,
        }
      );
      if (burn.deficit !== 0)
        return { text: HANDOVER_TEXT, source: 'handover' };
    } catch (err) {
      console.error('[lead-question] credit burn failed:', err);
      return { text: HANDOVER_TEXT, source: 'handover' };
    }
  }

  try {
    const languageConstraint = requiresEnglishReply(question)
      ? 'The buyer wrote in English. Answer only in English; do not use any Indian-language script.'
      : 'Answer in the same language and script as the buyer.';
    const prompt = `Property details:\n${buildPropertyContext(qaProperty)}\n\nBuyer's question: ${question}\n\n${languageConstraint}\n\nAnswer:`;
    const instructionPrompt = botInstructionPrompt(args.botInstructions ?? []);
    const raw = await generateText(
      prompt,
      `${PROPERTY_QA_SYSTEM_PROMPT}${instructionPrompt}`,
      { feature: AI_FEATURE }
    );
    const answer = (raw || '').trim();
    // The system prompt tells Gemini to refuse rather than invent. A
    // refusal is a handover, not an answer.
    if (!answer) {
      return { text: HANDOVER_TEXT, source: 'handover' };
    }
    const appliedInstructionIds = (args.botInstructions ?? []).map(
      (rule) => rule.id
    );
    if (
      isNonAnswer(answer) ||
      !replyMatchesQuestionLanguage(question, answer)
    ) {
      return {
        text: HANDOVER_TEXT,
        source: 'handover',
        appliedInstructionIds,
      };
    }
    return {
      text: answer,
      source: 'ai',
      appliedInstructionIds,
    };
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
  // "Please share your contact number and a convenient time" asks a
  // lead writing from WhatsApp for the number they are writing from,
  // and promises a call nobody was told to make.
  if (
    /\b(share|send|provide|give)( me| us)? your (contact|phone|mobile|whatsapp)( number| no\.?| details)?\b/i.test(
      text
    )
  ) {
    return true;
  }
  return /\b(let me (confirm|check|find out|verify)|i(?:'?ll| will) (confirm|check|find out|verify|get back)|(come|get) (right )?back to you|check (on )?(that|this) and revert|revert (on|to) you)\b/i.test(
    text
  );
}
