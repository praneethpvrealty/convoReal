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

const WHAT_ELSE =
  /^(?:(?:ok(?:ay)?|yes)[,.!\s]*)*(?:what|anything|something)\s+else(?:\s+(?:do\s+)?(?:you|u)\s+have)?\s*[?.!]*$/i;

/** True when the message asks for more listings and states nothing
 *  else — no requirement, no question about a specific listing. */
export function requestsMoreListings(text?: string | null): boolean {
  const value = (text || '').trim();
  if (!value || value.split(/\s+/).length > 12) return false;
  return MORE_LISTINGS.test(value) || WHAT_ELSE.test(value);
}
