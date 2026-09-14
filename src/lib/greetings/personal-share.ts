import { greetingName } from '@/lib/contacts/lead-placeholder';

export const PERSONAL_GREETING_CARD_LABEL = 'View your greeting card:';

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
    `Dear ${greetingName(contactName)},`,
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
