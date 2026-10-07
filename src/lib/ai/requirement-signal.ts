// The free test for "does this message state what someone is looking
// for?", split out of buyer-qualification so the router can ask it
// without importing the ladder that the router is consulted by.
//
// It gates a paid extraction, so it must stay deterministic and free.

export const PROPERTY_TYPE_WORDS =
  '(?:land|plot|site|acres?|guntha|cents?|flat|apartment|villa|house|duplex|penthouse|studio|bhk|commercial|office|shop|retail|showroom|warehouse|godown|farm ?land|farmhouse|agricultur\\w*|residential|independent|builder floor)';

const PROPERTY_TYPE_SIGNAL = new RegExp(`\\b${PROPERTY_TYPE_WORDS}\\b`, 'i');

const BUDGET_SIGNAL =
  /(\d+\s*(?:\.\d+)?\s*(?:cr|crore|crores|lakh|lakhs|lac|lacs|l|k)\b)|\b\d{6,}\b/i;

const SIZE_SIGNAL =
  /\b\d[\d,.]*\s*(?:sq\.?\s*(?:ft|feet|yds?|yards?|mtrs?|m)|sqft|sft|square\s*(?:feet|foot|yards?|met(?:er|re)s?)|guntas?|grounds?)\b|\b\d{2,3}\s*(?:x|×|\*|by)\s*\d{2,3}\b/i;

const RUPEE_FIGURE = /(?:₹|\brs\.?|\binr)\s*\d/i;
const NOT_A_MEASURE =
  '(?![\\d,.]|\\s*(?:bhk|bed|bedrooms?|br\\b|rk\\b|sq\\w*|sft|ft|feet|acres?|cents?|guntas?|grounds?|floors?|stor(?:e)?y|years?|yrs?|months?|km|kms|mins?|minutes?)\\b)';
const GROUPED_FIGURE = new RegExp(
  `\\b\\d{1,3}(?:,\\d{2,3})+${NOT_A_MEASURE}`,
  'i'
);
const BUDGET_WITH_FIGURE = new RegExp(
  `\\bbudget\\b[^\\d]{0,20}\\d[\\d,.]*${NOT_A_MEASURE}`,
  'i'
);

/** True when the message states a budget figure, in any of the forms
 *  the preference extraction can read: "2 Cr", "₹2,00,00,000",
 *  "Rs 50 lakh", "budget 200". */
export function statesBudget(text?: string | null): boolean {
  const clean = (text || '').trim();
  return (
    BUDGET_SIGNAL.test(clean) ||
    RUPEE_FIGURE.test(clean) ||
    GROUPED_FIGURE.test(clean) ||
    BUDGET_WITH_FIGURE.test(clean)
  );
}

const QUESTION_SHAPE =
  /\?|^(is|are|was|were|does|do|did|can|could|will|would|which|what|where|who|whom|how|why|when|has|have)\b/i;

const LISTING_REFERENCE =
  /\b(this|it|that|these|those|the (one|same|listing|property|house|plot|site|flat|apartment|villa|building|unit|land|place)|you (sent|shared|showed|posted)|the (photo|picture|pic|image|video))\b/i;

// Verbs and openers that state a search, not a question about the
// listing in hand. No qualifier words ("under", "within", "max"): a
// figure is what makes "under 2 Cr" a budget, and statesBudget reads
// the figure, while "is this plot under contract?" is a status question.
const REQUIREMENT_INTENT =
  /\b(looking|want|need|interested|searching|require|prefer|suggest|options?|any|have you|do you have|get me|find|show me|send me|share)\b/i;

/**
 * True when a question is about the listing already in the thread —
 * "is it this pink house or the one next to it?", "is this still for
 * sale?" — rather than a statement of what the lead wants.
 *
 * Such a message carries a property-type word by construction (the
 * listing is a house), which used to make it a requirement: the ladder
 * paid for an extraction, filed nothing, stood down, and the question
 * answerer was gated off it, so the lead heard nothing at all. A
 * question that states a budget, a size, or an intent to find
 * something ("do you have any villa under 2 Cr?") is still a
 * requirement.
 */
export function asksAboutSharedListing(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  return (
    QUESTION_SHAPE.test(clean) &&
    LISTING_REFERENCE.test(clean) &&
    !statesBudget(clean) &&
    !SIZE_SIGNAL.test(clean) &&
    !REQUIREMENT_INTENT.test(clean)
  );
}

/**
 * True when an inbound message plausibly carries requirement detail —
 * a property type, a budget figure, a size, or an explicit "looking for".
 */
export function carriesRequirementSignal(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (asksAboutSharedListing(clean)) return false;
  return (
    PROPERTY_TYPE_SIGNAL.test(clean) ||
    statesBudget(clean) ||
    SIZE_SIGNAL.test(clean)
  );
}
