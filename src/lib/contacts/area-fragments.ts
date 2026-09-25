/**
 * Address fragments that reach a contact's areas as if they were
 * localities: the door number a portal lead's listing address opens
 * with ("#365, 5th Cross, …" filed the buyer under "#365"), a survey
 * number, a bare "Block"/"Sector"/"Phase" left over from splitting
 * "6th block, F Sector", or a street ("24th Main"). None names a place
 * a listing can be matched against, and the bot reads each one back to
 * the buyer ("listings near #365").
 */

const GENERIC_PART =
  /^(?:block|sector|phase|stage|cross|main|road|street|layout|nagar|colony|floor|wing|tower)s?$/i;
const NUMBERED_PART =
  /^(?:no\.?\s*)?\d+[a-z]{0,2}\s+(?:block|sector|phase|stage|floor|wing|tower|(?:main|cross)(?:\s+(?:road|rd|street|st))?)\.?$/i;
const SURVEY_NUMBER =
  /^(?:sy|survey|site|plot|door|flat|house)\.?\s*(?:no|number)\b/i;

export function isAreaFragment(area: string): boolean {
  const text = area.trim().replace(/[.,;:]+$/, '');
  if (!/\p{L}{2,}/u.test(text)) return true;
  if (text.startsWith('#')) return true;
  return (
    GENERIC_PART.test(text) ||
    NUMBERED_PART.test(text) ||
    SURVEY_NUMBER.test(text)
  );
}

/**
 * The areas worth saving from a list: entries joined by line breaks or
 * semicolons split apart, whitespace and trailing full stops trimmed,
 * address fragments dropped, and repeats (ignoring case) kept once.
 */
export function sanitizeAreaList(areas: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of areas) {
    if (typeof entry !== 'string') continue;
    for (const part of entry.split(/\s*[\n;]\s*/)) {
      const area = part.trim().replace(/\s+/g, ' ').replace(/\.+$/, '');
      if (!area || isAreaFragment(area)) continue;
      const key = area.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(area);
    }
  }
  return kept;
}
