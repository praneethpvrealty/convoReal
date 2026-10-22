// What a typed answer to an enquiry check-in means, when it is not a
// question, a call request or a date.
//
// The check-in asks one thing: is this listing still under
// consideration? Every typed answer used to be read as "yes" and sent
// the timeline question, so a buyer who wrote "You said its already
// sold" was asked when to be checked back on a plot they had just been
// told was gone, with their own words quoted back at them. A typed
// answer is now read for three things before anything is sent: the
// listing is gone, the enquiry should close, or the buyer is still
// considering it. Anything else is for a person to answer, not the bot.

const SOLD_REPORT_PATTERNS = [
  /\b(?:already|now)\s+sold\b/i,
  /\b(?:it|this|that|the\s+\w+)\s*(?:'s|’s|\s+is|\s+was|\s+has\s+been|\s+got)\s+(?:already\s+)?sold\b/i,
  /\b(?:its|it's|it’s)\s+(?:already\s+)?sold\b/i,
  /\bsold\s+out\b/i,
  /\b(?:been|got)\s+sold\b/i,
  /\bno\s+longer\s+available\b/i,
  /\b(?:already|been)\s+(?:booked|taken|gone)\b(?!\s+(?:a|an|the|my|our|for)\b)/i,
];

const CLOSE_REQUEST_PATTERNS = [
  /\bclose\s+(?:my|the|this|that)?\s*(?:enquiry|inquiry|enquiries|inquiries)\b/i,
  /\bno\s+(?:more|further)\s+(?:updates|messages|follow[- ]?ups)\b/i,
  /\bstop\s+(?:the\s+)?(?:updates|messages|follow[- ]?ups|sending|messaging|following\s+up)\b/i,
  /\b(?:not|no\s+longer)\s+looking\s+(?:any\s*more|now)\b/i,
  /\bno\s+longer\s+looking\b/i,
  /\b(?:already\s+)?(?:bought|purchased)\s+(?:elsewhere|another|somewhere\s+else)\b/i,
  /\balready\s+(?:bought|purchased|finali[sz]ed)\s+(?:another|elsewhere|one|some\s*thing\s+else|a\s+(?:different|flat|house|plot|villa|property|site|home|apartment))\b/i,
  /\bdropped\s+the\s+(?:plan|idea)\b/i,
];

const STILL_CONSIDERING_PATTERNS = [
  /^(?:yes|yeah|yea|yup|yep|ya|yah|haan|han|ji|ok|okay|okk?|k|sure|fine|noted|great|good|right|correct|thanks?|thank\s+you|ty|done)\b/i,
  /\bstill\b/i,
  /\b(?:interested|considering|thinking|discussing|deciding|evaluating|checking|reviewing|planning)\b/i,
  /\b(?:consider|think|discuss|decide|evaluate|check|review|plan)\s+(?:it|this|that|about|over|with|and)\b/i,
  /\b(?:family|wife|husband|parents|father|mother|partner|brother|sister|son|daughter|banker|bank|loan|lawyer|advocate|vaastu|vastu)\b/i,
  /\b(?:will|i'll|i’ll|shall|we'll|we’ll)\s+(?:let\s+you\s+know|update|confirm|revert|get\s+back|inform|call|come\s+back|tell|decide|check|discuss|think|visit|see)\b/i,
  /\blet\s+you\s+know\b/i,
  /\b(?:busy|travell?ing|out\s+of\s+(?:town|station|country|india)|abroad|away|unwell|sick)\b/i,
  /\b(?:need|give\s+me|want)\s+(?:some|more|a\s+little|a\s+bit\s+of)?\s*time\b/i,
  /\b(?:not\s+yet|later|soon|in\s+progress|undecided|not\s+decided|haven'?t\s+decided)\b/i,
  /^[\s👍🙏👌✅😊🙂]+$/u,
];

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The buyer says the listing has gone — sold, booked or no longer
 *  available — whether they read it somewhere or were told so. */
export function reportsListingSold(text?: string | null): boolean {
  const value = normalise(text || '');
  if (!value) return false;
  if (
    /\b(?:not|never|isn'?t|wasn'?t|hasn'?t|haven'?t|ain'?t)\s+(?:\w+\s+){0,2}sold\b/i.test(
      value
    )
  )
    return false;
  return SOLD_REPORT_PATTERNS.some((pattern) => pattern.test(value));
}

/** The buyer asks, in words, for what "Close my enquiry" does. */
export function asksToCloseEnquiry(text?: string | null): boolean {
  const value = normalise(text || '');
  if (!value) return false;
  return CLOSE_REQUEST_PATTERNS.some((pattern) => pattern.test(value));
}

/** The buyer is still weighing the listing up — the answer the
 *  timeline question ("when should we check back?") follows. */
export function readsAsStillConsidering(text?: string | null): boolean {
  const value = normalise(text || '');
  if (!value) return false;
  return STILL_CONSIDERING_PATTERNS.some((pattern) => pattern.test(value));
}

export type CheckinEnding = 'sold' | 'close';

export function readCheckinEnding(text?: string | null): CheckinEnding | null {
  if (reportsListingSold(text)) return 'sold';
  if (asksToCloseEnquiry(text)) return 'close';
  return null;
}
