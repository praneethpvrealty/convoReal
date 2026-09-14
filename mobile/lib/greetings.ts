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

export const PERSONAL_GREETING_CARD_LABEL = 'View your greeting card:';

const PLACEHOLDER_CONTACT_NAME =
  /^(?:(?:portal|housing|99acres|magic\s*bricks|others)\s+(?:lead|user)|user|unknown|guest|customer|anonymous)$/i;

function personalGreetingName(name?: string | null): string {
  const trimmed = name?.trim() ?? '';
  return !trimmed || PLACEHOLDER_CONTACT_NAME.test(trimmed) ? 'there' : trimmed;
}

export function buildPersonalGreetingMessage({
  messageText,
  contactName,
  senderName,
  cardUrl,
}: {
  messageText: string;
  contactName?: string | null;
  senderName?: string | null;
  cardUrl?: string | null;
}): string {
  const lines = [
    `Dear ${personalGreetingName(contactName)},`,
    '',
    messageText.trim(),
    '',
    'Warm regards,',
    senderName?.trim() || 'Your property consultant',
  ];

  if (cardUrl) {
    lines.push('', `${PERSONAL_GREETING_CARD_LABEL} ${cardUrl}`);
  }

  return lines.join('\n');
}

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

export type AudienceType = 'all' | 'tags' | 'contacts';
export type GreetingAudience =
  | { type: 'all' }
  | { type: 'tags'; tagIds: string[] }
  | { type: 'contacts'; contactIds: string[] };

/** The audience payload POST /api/greetings/[id]/send expects. */
export function buildGreetingAudience(
  type: AudienceType,
  tagIds: string[],
  contactIds: string[] = []
): GreetingAudience {
  if (type === 'tags') return { type: 'tags', tagIds };
  if (type === 'contacts') return { type: 'contacts', contactIds };
  return { type: 'all' };
}

/** Whether the send button may fire: filtered audiences need a selection. */
export function canSendGreeting(
  type: AudienceType,
  tagIds: string[],
  templateStatus: string | null,
  contactIds: string[] = []
): boolean {
  if (templateStatus !== 'APPROVED') return false;
  if (type === 'tags') return tagIds.length > 0;
  if (type === 'contacts') return contactIds.length > 0;
  return true;
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
