import type { TranscriptMessage } from './transcript-rules';

export interface ReviewForExport {
  review_day: string;
  conversation_id: string;
  transcript: TranscriptMessage[];
  rule_violations: Array<{ rule: string }>;
  contacts?: { created_at: string | null } | null;
}

/**
 * A reviewed thread as a fixture file for transcripts/fixtures: the
 * violations the rules found become the ones the fixture test must
 * keep finding. Names are left for the person saving it to change;
 * numbers and emails are already masked.
 */
export function fixtureFromReview(review: ReviewForExport): string {
  const mask = (text: string) =>
    text
      .replace(/(?:\+?\d[\s-]?){10,}/g, '[number]')
      .replace(/\S+@\S+\.\S+/g, '[email]');
  return JSON.stringify(
    {
      id: `${review.review_day}-${review.conversation_id.slice(0, 8)}`,
      source: `Production thread reviewed ${review.review_day}; names to be changed, phone and email left out.`,
      context: {
        contactCreatedAt: review.contacts?.created_at ?? null,
        maxBotBubblesPerTurn: 2,
      },
      expectedViolations: [
        ...new Set(review.rule_violations.map((v) => v.rule)),
      ],
      transcript: review.transcript.map((bubble) => ({
        sender: bubble.sender,
        kind: bubble.kind,
        ...(bubble.templateName ? { templateName: bubble.templateName } : {}),
        ...(bubble.at ? { at: bubble.at } : {}),
        text: mask(bubble.text),
      })),
    },
    null,
    2
  );
}
