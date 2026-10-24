// ============================================================
// "More site", "any other options?", "next" — a lead answering a
// shortlist by asking for more of it. The words carry no requirement
// (nothing to extract, nothing to ask), only an order: the next
// listings the ledger says this lead has not seen.
//
// Anchored to the whole message on purpose. "need more area in HSR"
// is a requirement and stays with the ladder; a bare "more site" is
// not, even though "site" is a property-type word.
// ============================================================

const MORE_LISTINGS =
  /^(?:(?:ok(?:ay)?|yes|pls|please|sir|madam)[,.!\s]*)*(?:(?:can|could|do)\s+(?:you|u)\s+)?(?:(?:pls|please)\s+)?(?:(?:show|send|share|give|suggest|get)\s+(?:me\s+)?)?(?:(?:any|some|few|a\s+few|couple(?:\s+of)?)\s+)?(?:more|other|another|next|else|additional)\s*(?:few\s+)?(?:sites?|plots?|options?|properties|property|listings?|lands?|houses?|flats?|apartments?|villas?|ones?|choices?|alternatives?)?\s*(?:(?:in|near|at|around)\s+[\p{L}\p{N}\s.'&/-]{1,40})?\s*(?:pls|please|sir|madam)?\s*[?.!]*$/iu;

// "What all are available", "what else is available", "any other
// properties available": asked about a sold listing, the first of
// these used to be answered with that listing's regret, because the
// word "available" is what the status matcher keys on.
const WHAT_ELSE =
  /^(?:(?:ok(?:ay)?|yes|pls|please|sir|madam)[,.!\s]*)*(?:(?:what|which|anything|something)\s+(?:all|else)(?:\s+(?:is|are|do\s+you\s+have|you\s+have|u\s+have|available|there|options?|properties|listings?))*|what\s+(?:all\s+)?(?:(?:is|are)\s+)?(?:(?:the\s+)?other\s+(?:options?|properties|listings?|sites?|plots?)\s+)?(?:are\s+)?available(?:\s+(?:with\s+you|now|there))?|(?:any|what)\s+other\s+(?:properties|listings?|options?|sites?|plots?)(?:\s+(?:are\s+)?available)?)\s*[?.!]*$/i;

/** True when the message asks for more listings and states nothing
 *  else — no requirement, no question about a specific listing. */
export function requestsMoreListings(text?: string | null): boolean {
  const value = (text || '').trim();
  if (!value || value.split(/\s+/).length > 12) return false;
  return MORE_LISTINGS.test(value) || WHAT_ELSE.test(value);
}
