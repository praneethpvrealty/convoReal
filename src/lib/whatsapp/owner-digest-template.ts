// The predefined "owner_property_digest" WhatsApp template — the
// template-first channel for periodic property status digests to
// OWNERS/SELLERS. Owners rarely have an open 24-hour service window
// (they aren't chatting daily), so the pre-approved Utility template is
// the primary path; an open window upgrades to the richer free-form
// per-property breakdown. Same one-click submit flow as
// new_property_alert; pure functions so payload and params are
// unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const OWNER_DIGEST_TEMPLATE_NAME = 'owner_property_digest';

export function buildOwnerDigestTemplatePayload(): TemplatePayload {
  return {
    name: OWNER_DIGEST_TEMPLATE_NAME,
    // Utility: a transactional status update about the owner's own
    // listing, not promotional content.
    category: 'Utility',
    language: 'en_US',
    body_text: [
      '📊 *Your Property Update*',
      '',
      'Hi {{1}}, here is the latest buyer activity on {{2}}:',
      '',
      '📈 Summary: {{3}}',
      '',
      'Reply to this message for details or to talk to your agent.',
    ].join('\n'),
    footer_text: 'Reply STOP UPDATES to pause these updates',
    buttons: [
      // A tap opens the 24h window, so the follow-up conversation
      // continues free-form in the CRM Inbox.
      { type: 'QUICK_REPLY', text: 'Tell me more' },
      { type: 'QUICK_REPLY', text: 'Pause updates' },
    ],
    sample_values: {
      body: [
        'Gopi',
        'your 2 listings (this week)',
        '4 new enquiries · 2 buyers shortlisted · 1 site visit scheduled · 38 showcase views',
      ],
    },
  };
}

// ── Consent request template ──────────────────────────────────────
// Sent ONCE per owner before any digest — the consent-first gate.
// Quick replies land back in the webhook as button text and move
// contacts.owner_digest_consent to granted/declined.

export const OWNER_DIGEST_CONSENT_TEMPLATE_NAME = 'owner_digest_consent'

export const CONSENT_YES_TEXT = 'Yes, send me updates'
export const CONSENT_NO_TEXT = 'No, thanks'

export function buildOwnerDigestConsentTemplatePayload(): TemplatePayload {
  return {
    name: OWNER_DIGEST_CONSENT_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, buyers have been showing interest in {{2}}.',
      '',
      'Would you like to receive a short WhatsApp status update (new enquiries, shortlists and scheduled site visits) whenever there is fresh buyer activity on your property?',
      '',
      'You can change your mind anytime by replying STOP UPDATES or START UPDATES.',
    ].join('\n'),
    buttons: [
      { type: 'QUICK_REPLY', text: CONSENT_YES_TEXT },
      { type: 'QUICK_REPLY', text: CONSENT_NO_TEXT },
    ],
    sample_values: {
      body: ['Gopi', 'your listing'],
    },
  }
}

/**
 * "your listing" reads as spam when the owner has no idea which
 * property triggered the message ("Which land are you talking about?").
 * Naming the property answers that before the owner has to ask.
 */
export function buildListingsPhrase(propertyTitles: string[]): string {
  const titles = propertyTitles.map((t) => t?.trim()).filter(Boolean)
  if (titles.length === 1) return `your listing "${titles[0]}"`
  if (titles.length === 2) return `your listings "${titles[0]}" and "${titles[1]}"`
  if (titles.length > 2) return `your ${titles.length} listings ("${titles[0]}" and more)`
  return 'your listing'
}

/** Body params {{1}}..{{2}}: first name, listings phrase. */
export function buildOwnerDigestConsentParams(
  contactName: string | null | undefined,
  propertyTitles: string[]
): [name: string, listings: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there'
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(buildListingsPhrase(propertyTitles)),
  ]
}

/**
 * Body params {{1}}..{{3}}: first name, listings phrase (with period),
 * compact activity summary. Every param is guaranteed non-empty (Meta
 * rejects empty values) and newline-free (sanitizeTemplateParam).
 */
export function buildOwnerDigestParams(
  contactName: string | null | undefined,
  propertyTitles: string[],
  periodLabel: string,
  summaryLine: string
): [name: string, listings: string, summary: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${buildListingsPhrase(propertyTitles)} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
  ];
}
