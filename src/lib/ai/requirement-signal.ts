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

// "Location road width", "Size in sft", "rent per month": a buyer
// naming the field they want, with no verb at all. Not a question by
// shape and not a requirement, it fell to the qualification ladder,
// which answered "Location road width" with a fresh shortlist.
const LISTING_ATTRIBUTE =
  '(?:exact location|location|address|plot (?:no|number)|site (?:no|number)|survey (?:no|number)|block(?: (?:no|number))?|road width|width of (?:the )?road|approach road|rent per month|monthly rent|rental income|rent amount|asking price|price|rate|cost|size in (?:sq\\.? ?ft|sft|sqft)|size|area|built.?up(?: area)?|carpet area|measurement|dimensions?|plot size|site size|facing|direction|age(?: of (?:the )?(?:building|property|house))?|year built|khata|katha|floors?|parking|amenities|possession|maintenance|deposit|advance)';

const LISTING_ATTRIBUTE_MESSAGE = new RegExp(
  `^(?:(?:what(?:'s| is| are)?|and|also|pls|please|the|its|your|tell me|share|send)\\s+)*(?:${LISTING_ATTRIBUTE}(?:\\s*(?:,|&|and|/|\\+)?\\s*)){1,3}(?:(?:of|for|in|on)\\s+(?:this|it|that|the\\s+\\w+(?:\\s+\\w+)?))?(?:\\s+(?:pls|please|sir|madam))*\\s*[?.!]*$`,
  'i'
);

/** The listing fields a message names, in order: "Location, road
 *  width" → ["Location", "road width"]. */
export function namedListingAttributes(text?: string | null): string[] {
  return (
    (text || '').match(new RegExp(`\\b${LISTING_ATTRIBUTE}\\b`, 'gi')) ?? []
  );
}

/** True when the message is nothing but the name of a listing field
 *  the buyer wants — "Location road width", "Size in sft?". */
export function asksListingAttribute(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean || clean.split(/\s+/).length > 8) return false;
  return (
    LISTING_ATTRIBUTE_MESSAGE.test(clean) &&
    !statesBudget(clean) &&
    !SIZE_SIGNAL.test(clean)
  );
}

const QUESTION_SHAPE =
  /\?|^(is|are|was|were|does|do|did|can|could|will|would|which|what|where|who|whom|how|why|when|has|have)\b/i;

const LISTING_REFERENCE =
  /\b(this|it|that|these|those|the (one|same|listing|property|house|plot|site|flat|apartment|villa|building|unit|land|place)|(?:you|u)(?:'ve| have|'d| had)? (sent|shared|showed|shown|posted|forwarded)|the (photo|picture|pic|image|video|location|map|pin))\b/i;

// "Based on the location you've sent, it doesn't seem to be a 30-50
// plot": a buyer disputing a fact about the listing in hand. Not a
// question by shape, and "plot" made it a requirement, so the ladder
// filed it, asked buy-or-rent, and five replies later pitched a house
// in a locality the buyer never named. A dispute is settled by a
// person, never by a new shortlist.
//
// Every phrasing needs a listing fact beside it: "sorry wrong number,
// this isn't for me" and "that doesn't look good" name none.
const LISTING_DISPUTE =
  /\b(?:doesn'?t|does not|didn'?t|did not|isn'?t|is not|wasn'?t|was not|not)\s+(?:seem|look|appear|match|matching|the same)\b|\bmismatch(?:ed|es)?\b/i;
const LISTING_DISPUTE_BARE =
  /\b(?:wrong|incorrect|inaccurate|not (?:correct|right|accurate))\b|\b(?:seems?|looks?|appears?)\s+(?:different|wrong|off|incorrect|smaller|bigger|larger)\b/i;

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
// Verbs and openers that state a search, not a question about the
// listing in hand. No qualifier words ("under", "within", "max"): a
// figure is what makes "under 2 Cr" a budget, and statesBudget reads
// the figure, while "is this plot under contract?" is a status question.
const REQUIREMENT_INTENT =
  /\b(looking|want|need|interested|searching|require|prefer|suggest|options?|any|have you|do you have|get me|find|show me|send me|share)\b/i;

const LISTING_FACT = new RegExp(
  `\\b(?:${LISTING_ATTRIBUTE}|${PROPERTY_TYPE_WORDS}|photos?|pictures?|pics?|images?|map|pin)\\b`,
  'i'
);

// "This doesn't match my budget", "it doesn't seem worth it", "these
// properties are not matching my requirement", "this area doesn't look
// good": the lead is turning the listing down, not disputing its record.
const REJECTION =
  /\b(?:budget|afford(?:able)?|expensive|costly|pricey|overpriced|worth|requirements?|criteria|preferences?|not what|what (?:i|we) (?:asked|need|want|said|am looking|are looking)|not for (?:me|us)|not interested|wrong (?:number|person|contact)|never (?:enquired|inquired|asked|contacted|requested)|something (?:else|different))\b|\b(?:doesn'?t|does not|don'?t|do not|not)\s+(?:look|seem|feel)\s+(?:good|great|nice|fine|ok(?:ay)?|suitable|convenient|right for)\b/i;

/**
 * True when the message disputes a fact about the listing already in
 * the thread: it refers to the listing, names a fact of it (a listing
 * field, a property-type word, the photo or the map) and says that fact
 * is off. A dispute that states a size or a budget is a correction the
 * ladder can file ("that's wrong, 30x40 corner site"), a search verb
 * makes it a requirement, and budget or requirement talk is a
 * rejection; all three stay with the ladder.
 */
export function disputesSharedListing(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (!LISTING_REFERENCE.test(clean) || !LISTING_FACT.test(clean)) return false;
  if (!LISTING_DISPUTE.test(clean) && !LISTING_DISPUTE_BARE.test(clean))
    return false;
  return (
    !statesBudget(clean) &&
    !SIZE_SIGNAL.test(clean) &&
    !REJECTION.test(clean) &&
    !REQUIREMENT_INTENT.test(clean)
  );
}

export function asksAboutSharedListing(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (asksListingAttribute(clean)) return true;
  if (disputesSharedListing(clean)) return true;
  return (
    QUESTION_SHAPE.test(clean) &&
    LISTING_REFERENCE.test(clean) &&
    !statesBudget(clean) &&
    !SIZE_SIGNAL.test(clean) &&
    !REQUIREMENT_INTENT.test(clean)
  );
}

const DETAILS_ASK =
  /\b(?:details?|info|information|specs?|specifications?|brochure|more about|tell me about)\b/i;

export function asksDetailsOfDescribedListing(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean || clean.split(/\s+/).length > 16) return false;
  return DETAILS_ASK.test(clean) && !REQUIREMENT_INTENT.test(clean);
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
