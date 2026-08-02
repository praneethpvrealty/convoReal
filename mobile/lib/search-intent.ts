/**
 * Does this query describe a property rather than a place?
 *
 * The Properties search box doubles as a locality autocomplete, but a
 * query the server's search parser understands ("commercial < 9.5 cr",
 * "3bhk under 80L") has no locality answer — Google Places just matches
 * the words against business names and buries the real results under
 * hostels and design agencies, one billed call per keystroke.
 *
 * Patterns mirror src/lib/search-parser.ts, which is what actually runs
 * on these queries server-side. Anything structured suppresses the
 * dropdown; a plain "Whitefield" still gets suggestions.
 */
const STRUCTURED_PATTERNS = [
  // > 20 cr, <= 80L, < 9.5 cr
  /[><]=?\s*(?:rs\.?\s*|inr\s*|₹\s*)?\d/i,
  // 9.5 cr, 80 lakhs, 500k, 80L — the shorthand the placeholder advertises
  /\d(?:\.\d+)?\s*(?:cr(?:ore)?s?|lakh?s?|lacs?|l|k)\b/i,
  // 3bhk, 3 bedroom, 2 bed
  /\b\d+\s*-?\s*(?:bhk|bedrooms?|beds?)\b/i,
  // 30000 sqft, 2 acres, 5 guntas
  /\d\s*(?:sq\.?\s*(?:ft|feet|meters?|mtr|m)|sqft|sqm|acres?|guntas?|grounds?|cents?)\b/i,
  // under 80, above 2, between 1 and 3 — the bound keywords the parser reads
  /\b(?:under|below|less\s+than|max(?:imum)?|upto?|up\s+to|within|above|over|more\s+than|greater\s+than|min(?:imum)?|at\s+least|between|starting\s+(?:from|at))\s+(?:rs\.?\s*|inr\s*|₹\s*)?\d/i,
];

export function isStructuredQuery(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return STRUCTURED_PATTERNS.some((re) => re.test(q));
}
