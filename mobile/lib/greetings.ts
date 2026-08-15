// ------------------------------------------------------------------
// Occasion greetings — the pure pieces of the screen, kept RN-free so
// they run under the plain Node vitest runner.
//
// The occasion catalog itself is NOT duplicated here: festival dates
// shift every year, and a copy inside an installed build would go
// stale silently. GET /api/greetings/occasions serves it from
// src/lib/greetings/occasions.ts, the same module the web imports.
// ------------------------------------------------------------------

/** Mirrors GREETING_MESSAGE_MAX in src/lib/greetings/generate.ts. */
export const GREETING_MESSAGE_MAX = 600;

export const GREETING_TONES = ['warm', 'festive', 'formal'] as const;
export type GreetingTone = (typeof GREETING_TONES)[number];

export interface Greeting {
  id: string;
  occasion_id: string | null;
  occasion_label: string;
  message_text: string;
  image_path: string | null;
  status: 'draft' | 'sent';
  broadcast_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface UpcomingOccasion {
  id: string;
  label: string;
  emoji: string;
  date: string;
  daysUntil: number;
}

export type AudienceType = 'all' | 'tags';

/** The audience payload POST /api/greetings/[id]/send expects. */
export function buildGreetingAudience(
  type: AudienceType,
  tagIds: string[]
): { type: AudienceType; tagIds?: string[] } {
  return type === 'tags' ? { type: 'tags', tagIds } : { type: 'all' };
}

/** Whether the send button may fire: a tag audience needs a tag. */
export function canSendGreeting(
  type: AudienceType,
  tagIds: string[],
  templateStatus: string | null
): boolean {
  if (templateStatus !== 'APPROVED') return false;
  return type === 'all' || tagIds.length > 0;
}

/** How far away an occasion reads on the card. */
export function occasionCountdown(daysUntil: number): string {
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

/**
 * What to tell the agent when the shared occasion_greeting template is
 * not usable yet. Null means it is approved and sends may go out.
 * Wording tracks the same states the send route returns.
 */
export function templateBlockReason(
  status: string | null,
  rejectionReason?: string | null
): string | null {
  if (status === 'APPROVED') return null;
  if (status === null) {
    return 'Your account does not have the greeting template yet. It is submitted to Meta once and reused for every occasion.';
  }
  if (status === 'PENDING') {
    return 'The greeting template is awaiting Meta approval — sends unlock the moment it is approved.';
  }
  if (status === 'REJECTED') {
    return `Meta rejected the greeting template${rejectionReason ? `: ${rejectionReason}` : ''}. Edit and resubmit it from the web app under Settings → Templates.`;
  }
  return `The greeting template is not usable right now (status: ${status}).`;
}
