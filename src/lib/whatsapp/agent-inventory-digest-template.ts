// The predefined "agent_listing_activity_update" WhatsApp template — the
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

export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAME = 'agent_listing_activity_update';

/**
 * The pre-rewrite name. Meta reserves a deleted template's name for
 * four weeks and refuses a category change on it for the whole window
 * ("You can't change the category for this message template while the
 * existing English (US) content is being deleted"), so the Utility
 * rewrite ships under a new name instead of waiting. Accounts still
 * holding an approved row under the old name keep sending from it —
 * same four body params — until the new one clears review.
 */
export const LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES = ['agent_inventory_digest'];

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
    // Every word here is read by Meta's categoriser: promotional
    // framing ("reach", "performed across our network"), the 📣
    // megaphone and a signup CTA in a sample value all push the
    // template to Marketing. Mirror owner_property_digest, which
    // clears review as Utility with the same footer and buttons.
    body_text: [
      '📊 *Your Listing Activity Update*',
      '',
      'Hi {{1}}, here is the latest buyer activity on {{2}}:',
      '',
      '📈 Summary: {{3}}',
      '',
      'Next step: {{4}}',
      '',
      'Reply to this message for details.',
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
        'Reply to this message to get the new buyer details',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{4}}: first name, listings phrase (with period),
 * compact reach summary, next step. The next step must stay
 * transactional — a signup or dashboard CTA in this param is what got
 * the template categorised as Marketing; the invite lives on the
 * free-form path instead. Every param is guaranteed non-empty (Meta
 * rejects empty values) and newline-free (sanitizeTemplateParam).
 */
export function buildAgentInventoryDigestParams(
  contactName: string | null | undefined,
  propertyCount: number,
  periodLabel: string,
  summaryLine: string,
  nextStepLine: string
): [name: string, listings: string, summary: string, nextStep: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const listingPhrase =
    propertyCount === 1 ? 'your referred listing' : `your ${propertyCount} referred listings`;
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${listingPhrase} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
    sanitizeTemplateParam(nextStepLine || 'Reply to this message for details.'),
  ];
}
