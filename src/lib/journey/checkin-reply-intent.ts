const SOLD_REPORT_PATTERNS = [
  /^\s*(?:already|now)\s+sold\s*(?:[.!,;]|\bna\b|$)/i,
  /(?<!\b(?:my|our|his|her|their|old|own|other)\s)\b(?:plot|site|property|flat|villa|house|apartment|land|listing|unit)\s+(?:is\s+|was\s+|has\s+been\s+|got\s+)?(?:already\s+)?sold\b/i,
  /\b(?:it|this|that|the\s+\w+)\s*(?:'s|’s|\s+is|\s+was|\s+has\s+been|\s+got)\s+(?:already\s+)?sold\b/i,
  /\b(?:its|it's|it’s)\s+(?:already\s+)?sold\b/i,
  /\bsold\s+out\b/i,
  /\b(?:been|got)\s+sold\b/i,
  /\bno\s+longer\s+available\b/i,
  /\b(?:it|its|this|that|the\s+(?:plot|site|property|flat|villa|house|apartment|land|listing|unit|one))\s*(?:'s|’s|\s+is|\s+was|\s+has\s+been|\s+got)?\s+(?:already\s+)?(?:booked|gone)\b(?!\s+(?:for|on|at|to|through|by)\b)/i,
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

export function asksToCloseEnquiry(text?: string | null): boolean {
  const value = normalise(text || '');
  if (!value) return false;
  return CLOSE_REQUEST_PATTERNS.some((pattern) => pattern.test(value));
}

export function readsAsStillConsidering(text?: string | null): boolean {
  const value = normalise(text || '');
  if (!value) return false;
  return STILL_CONSIDERING_PATTERNS.some((pattern) => pattern.test(value));
}

export type CheckinEnding = 'sold' | 'close';

const STILL_INTERESTED =
  /\b(?:still|remain|am|are|i'm|i’m|we're|we’re)\s+(?:very\s+)?(?:interested|keen|considering|looking\s+at\s+(?:it|this|that))\b/i;

export function readCheckinEnding(text?: string | null): CheckinEnding | null {
  if (STILL_INTERESTED.test(text || '')) return null;
  if (reportsListingSold(text)) return 'sold';
  if (asksToCloseEnquiry(text)) return 'close';
  return null;
}
