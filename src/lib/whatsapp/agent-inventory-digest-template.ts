// The predefined "agent_property_digest" WhatsApp template — the
// template-first channel for periodic reach digests to SOURCE AGENTS
// (partner agents whose inventory this account lists, e.g. Deepak when
// Suresh added Deepak's properties as agent-referred). Source agents
// rarely have an open 24-hour service window, so the pre-approved
// Utility template is the primary path; an open window upgrades to the
// richer free-form per-property breakdown. Same one-click submit flow
// as owner_property_digest; pure functions so payload and params are
// unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAME = 'agent_property_digest';

/**
 * Earlier names, newest first. Meta decides a template's category when
 * it reviews the creation and never again — an edit that changes it is
 * refused outright ("You cannot update an approved template category"),
 * and deleting a template reserves its name for four weeks. So a
 * template that came back Marketing is Marketing for good, and a
 * corrected one can only ship under a name Meta has not seen. Accounts
 * still holding an approved row under an older name keep sending from
 * it until the new one clears review.
 */
export const LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES = [
  'agent_listing_activity_update',
  'agent_inventory_digest',
];

export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES = [
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  ...LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
];

export function buildAgentInventoryDigestTemplatePayload(): TemplatePayload {
  return {
    name: AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
    // Utility: a transactional status update about the agent's own
    // referred inventory, not promotional content.
    category: 'Utility',
    language: 'en_US',
    // owner_property_digest is the control: same footer, same buttons,
    // approved as Utility. Two rewrites of this template were still
    // categorised Marketing, and what it had that the control did not
    // was a fourth free-text param introduced as "Next step:" — a slot
    // Meta cannot inspect, announced as a call to action. Dropping it
    // leaves the two templates structurally identical.
    body_text: [
      '📊 *Your Listing Update*',
      '',
      'Hi {{1}}, here is the latest buyer activity on {{2}}:',
      '',
      '📈 Summary: {{3}}',
      '',
      'Reply to this message for details or to talk to our team.',
    ].join('\n'),
    footer_text: 'Reply STOP UPDATES to pause these updates',
    buttons: [
      // A tap opens the 24h window, so the follow-up conversation
      // continues free-form in the Engine Inbox.
      { type: 'QUICK_REPLY', text: 'Tell me more' },
      { type: 'QUICK_REPLY', text: 'Pause updates' },
    ],
    sample_values: {
      body: [
        'Deepak',
        'your 3 referred listings (today)',
        '2 direct buyers reached · 1 indirect buyer via partner agents · 1 partner agent onboarded',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{3}}: first name, listings phrase (with period),
 * compact reach summary. Every param is guaranteed non-empty (Meta
 * rejects empty values) and newline-free (sanitizeTemplateParam).
 */
export function buildAgentInventoryDigestParams(
  contactName: string | null | undefined,
  propertyCount: number,
  periodLabel: string,
  summaryLine: string
): [name: string, listings: string, summary: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const listingPhrase =
    propertyCount === 1 ? 'your referred listing' : `your ${propertyCount} referred listings`;
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${listingPhrase} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
  ];
}

/**
 * How many distinct {{N}} the stored template body expects. Earlier
 * revisions of this template carry a fourth "Next step" param, and
 * sending a template fewer params than it declares is a Meta error.
 */
export function countTemplateBodyParams(bodyText: string | null | undefined): number {
  return new Set((bodyText || '').match(/\{\{\d+\}\}/g) ?? []).size;
}
