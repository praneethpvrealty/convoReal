// ------------------------------------------------------------------
// Agent-facing wording for `contacts.buyer_alerts_consent`.
//
// Ported from src/lib/contacts/alerts-consent.ts and guarded by
// src/lib/mobile-parity.test.ts. The rule itself lives on the server
// (PATCH /api/contacts/[id]/consent decides whether an override needs
// acknowledging); only the words an agent reads are duplicated, and
// they must not differ — two surfaces describing the same compliance
// state differently is worse than either wording alone.
// ------------------------------------------------------------------

export const CONSENT_STATES = ['pending', 'granted', 'declined'] as const;
export type AlertsConsent = (typeof CONSENT_STATES)[number];

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

export const CONSENT_OVERRIDE_WARNING =
  'This contact opted out themselves. Only opt them back in if they have since asked you to — their own reply is the record that matters.';

export function isConsentState(value: unknown): value is AlertsConsent {
  return (
    typeof value === 'string' &&
    (CONSENT_STATES as readonly string[]).includes(value)
  );
}
