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

/**
 * Body params {{1}}..{{3}}: first name, listings phrase (with period),
 * compact activity summary. Every param is guaranteed non-empty (Meta
 * rejects empty values) and newline-free (sanitizeTemplateParam).
 */
export function buildOwnerDigestParams(
  contactName: string | null | undefined,
  propertyCount: number,
  periodLabel: string,
  summaryLine: string
): [name: string, listings: string, summary: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const listingPhrase =
    propertyCount === 1 ? 'your listing' : `your ${propertyCount} listings`;
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${listingPhrase} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
  ];
}
