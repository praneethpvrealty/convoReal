// The free test for "does this message state what someone is looking
// for?", split out of buyer-qualification so the router can ask it
// without importing the ladder that the router is consulted by.
//
// It gates a paid extraction, so it must stay deterministic and free.

const PROPERTY_TYPE_SIGNAL =
  /\b(land|plot|site|acres?|guntha|cents?|flat|apartment|villa|house|duplex|penthouse|studio|bhk|commercial|office|shop|retail|showroom|warehouse|godown|farm ?land|farmhouse|agricultur\w*|residential|independent|builder floor)\b/i;

const BUDGET_SIGNAL =
  /(\d+\s*(?:\.\d+)?\s*(?:cr|crore|crores|lakh|lakhs|lac|lacs|l|k)\b)|\bbudget\b|\b\d{6,}\b/i;

/**
 * True when an inbound message plausibly carries requirement detail —
 * a property type, a budget figure, or an explicit "looking for".
 */
export function carriesRequirementSignal(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  return PROPERTY_TYPE_SIGNAL.test(clean) || BUDGET_SIGNAL.test(clean);
}
