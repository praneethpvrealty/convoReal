/**
 * Web parity: src/lib/journey/checkin-message.ts.
 *
 * The message an agent sends from a journey branch that has gone quiet.
 * The question is always the same one the branch is stuck on: is this
 * property still in play, or should it be parked?
 */

export interface CheckInMessageInput {
  /** Falls back to a plain greeting when the contact has no name. */
  contactName?: string | null;
  propertyTitle?: string | null;
  propertyCode?: string | null;
  /** Current stage, so the nudge reads as a follow-up, not a cold ping. */
  stageName?: string | null;
  /** Showcase link for the listing. Omitted when it can't be resolved —
   *  the question still stands without it. */
  propertyUrl?: string | null;
}

const clean = (value?: string | null) => value?.trim() || '';

export function buildCheckInMessage({
  contactName,
  propertyTitle,
  propertyCode,
  stageName,
  propertyUrl,
}: CheckInMessageInput): string {
  const name = clean(contactName).split(/\s+/)[0] ?? '';
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const title = clean(propertyTitle);
  const code = clean(propertyCode);
  const subject = title ? (code ? `${title} (${code})` : title) : code || 'the property we discussed';

  const stage = clean(stageName);
  const context = stage ? ` We had it at ${stage}.` : '';

  const question =
    `${greeting} just checking in on ${subject}.${context}` +
    ` Are you still considering this one, or should I park it and focus on other options?`;

  const link = clean(propertyUrl);
  return link ? `${question}\n\n📸 Photos & full details:\n${link}` : question;
}
