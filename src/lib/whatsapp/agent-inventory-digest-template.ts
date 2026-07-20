// The predefined "agent_inventory_digest" WhatsApp template — the
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

export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAME = 'agent_inventory_digest';

export function buildAgentInventoryDigestTemplatePayload(): TemplatePayload {
  return {
    name: AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
    // Utility: a transactional status update about the agent's own
    // referred inventory, not promotional content.
    category: 'Utility',
    language: 'en_US',
    body_text: [
      '📣 *Your Inventory Reach Update*',
      '',
      'Hi {{1}}, here is how {{2}} performed across our buyer network:',
      '',
      '📈 Summary: {{3}}',
      '',
      'Your next step: {{4}}',
      '',
      'Reply to this message for details.',
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
        'Deepak',
        'your 3 referred listings (today)',
        '2 direct buyers reached · 1 indirect buyer via partner agents · 1 partner agent onboarded',
        'Track your inventory network live on ConvoReal: https://www.convoreal.com/signup',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{4}}: first name, listings phrase (with period),
 * compact reach summary, closing line (signup invite for agents with
 * no ConvoReal profile, dashboard pointer otherwise). Every param is
 * guaranteed non-empty (Meta rejects empty values) and newline-free
 * (sanitizeTemplateParam).
 */
export function buildAgentInventoryDigestParams(
  contactName: string | null | undefined,
  propertyCount: number,
  periodLabel: string,
  summaryLine: string,
  closingLine: string
): [name: string, listings: string, summary: string, closing: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const listingPhrase =
    propertyCount === 1 ? 'your referred listing' : `your ${propertyCount} referred listings`;
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${listingPhrase} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
    sanitizeTemplateParam(closingLine || 'Reply to this message for details.'),
  ];
}
