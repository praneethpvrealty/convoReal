// Agent-facing handling of `contacts.buyer_alerts_consent`.
//
// The column is written from four places already — the contact's own
// STOP/START ALERTS reply (src/lib/buyer/alerts.ts), the buyer portal
// switch, the public requirements form, and mark-dead. This module adds
// the fifth: an agent recording what a client told them off-channel.
//
// The asymmetry below is the point. Moving someone to `declined` is
// always allowed — honouring an opt-out never needs a safeguard. Moving
// someone OFF `declined` undoes a refusal the contact made themselves,
// usually by replying STOP ALERTS, so it takes a deliberate
// acknowledgement rather than a stray tap in an edit form.

export const CONSENT_STATES = ['pending', 'granted', 'declined'] as const;
export type AlertsConsent = (typeof CONSENT_STATES)[number];

export function isConsentState(value: unknown): value is AlertsConsent {
  return (
    typeof value === 'string' &&
    (CONSENT_STATES as readonly string[]).includes(value)
  );
}

export const CONSENT_LABELS: Record<AlertsConsent, string> = {
  pending: 'Not asked yet',
  granted: 'Opted in',
  declined: 'Opted out',
};

export const CONSENT_HINTS: Record<AlertsConsent, string> = {
  pending:
    'They have not been asked. Marketing sends still reach them, but they have not agreed to them.',
  granted:
    'They agreed to updates and greetings. Included in opted-in-only sends.',
  declined:
    'They asked to stop. Excluded from every broadcast, greeting and alert, automatically.',
};

/** Shown before an agent can undo a contact's own opt-out. */
export const CONSENT_OVERRIDE_WARNING =
  'This contact opted out themselves. Only opt them back in if they have since asked you to — their own reply is the record that matters.';

/** True when moving from `current` to `next` undoes the contact's own refusal. */
export function consentOverrideNeedsAck(
  current: AlertsConsent,
  next: AlertsConsent
): boolean {
  return current === 'declined' && next !== 'declined';
}

/** The audit line written to contact_notes for a consent change. */
export function consentChangeNote(
  previous: AlertsConsent,
  next: AlertsConsent,
  reason?: string
): string {
  const base = `WhatsApp alerts consent changed: ${CONSENT_LABELS[previous]} → ${CONSENT_LABELS[next]} (recorded by an agent)`;
  return reason?.trim() ? `${base}\n\nReason: ${reason.trim()}` : base;
}
