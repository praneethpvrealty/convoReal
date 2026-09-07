import { TOURS } from './tours';

export function isListingAudienceShare(
  message: string,
  hasSelectedProperty = false
): boolean {
  return (
    /\b(?:share|send|forward)\b/i.test(message) &&
    (hasSelectedProperty ||
      /\b(?:property|properties|listing|listings)\b/i.test(message)) &&
    /\b(?:audience|(?:people|contacts|buyers|clients|leads).{0,50}(?:enquired|inquired|viewed|interested))\b/i.test(
      message
    )
  );
}

/**
 * Deterministic intent matcher run BEFORE any Gemini call. The most
 * common helper questions are "how do I X?" for one of the guided
 * tours — those are answered with a tour start and zero AI cost.
 * Only genuinely free-form questions fall through to the model.
 */
export function matchTourIntent(message: string): string | null {
  const text = message.trim();
  if (!text || text.length > 500) return null;
  if (isListingAudienceShare(text)) return null;
  for (const tour of TOURS) {
    if (tour.triggers.some((re) => re.test(text))) return tour.id;
  }
  return null;
}

/** Friendly canned reply used when the intent matcher short-circuits. */
export function cannedTourReply(tourTitle: string): string {
  return `Sure! Let me show you — follow the highlights on screen. \u{1F447} (${tourTitle})`;
}
