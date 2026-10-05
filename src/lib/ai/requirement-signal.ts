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

/**
 * True when an inbound message plausibly carries requirement detail —
 * a property type, a budget figure, a size, or an explicit "looking for".
 */
export function carriesRequirementSignal(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  return (
    PROPERTY_TYPE_SIGNAL.test(clean) ||
    statesBudget(clean) ||
    SIZE_SIGNAL.test(clean)
  );
}
