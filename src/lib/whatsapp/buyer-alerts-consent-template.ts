// The predefined "buyer_alerts_consent" WhatsApp template — the
// consent request the buyer match digest sends to a buyer with no open
// 24-hour window. Consent used to be asked only inside an open window,
// which meant buyers who never happen to be mid-chat at digest time
// were never asked at all and so never reached 'granted': the digest
// starved. This template carries the same question outside the window.
//
// Utility, and it has to be: it confirms a preference for someone who
// already gave this agency their requirement, carries no listing and
// no offer. The buttons reuse the free-text commands the inbox already
// understands (parseBuyerAlertsCommand), so a tap and a typed reply
// land in exactly the same handler.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { BRANDING } from '@/config/branding';

export const BUYER_ALERTS_CONSENT_TEMPLATE_NAME = 'buyer_alerts_consent';

/** Button texts must stay parseable by parseBuyerAlertsCommand — the
 *  webhook reads message.button.text through the same matcher as typed
 *  replies. Changing these silently breaks consent capture. */
export const BUYER_ALERTS_START_BUTTON = 'Start alerts';
export const BUYER_ALERTS_STOP_BUTTON = 'Stop alerts';

export function buildBuyerAlertsConsentTemplatePayload(): TemplatePayload {
  return {
    name: BUYER_ALERTS_CONSENT_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional, and
    // specific to a requirement the recipient themselves gave us.
    // No listings, no prices, no persuasion — a preference check.
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, you shared your property requirement with {{2}}.',
      '',
      'Would you like updates when a listing matches what you asked for? You can stop them at any time.',
    ].join('\n'),
    buttons: [
      { type: 'QUICK_REPLY', text: BUYER_ALERTS_START_BUTTON },
      { type: 'QUICK_REPLY', text: BUYER_ALERTS_STOP_BUTTON },
    ],
    sample_values: {
      body: ['Gopi', 'Aryavart Ventures'],
    },
  };
}

/**
 * Body params {{1}}..{{2}}: first name and the agency asking. Every
 * param is guaranteed non-empty (Meta rejects empty values), and a
 * portal placeholder name is never used as a form of address.
 */
export function buildBuyerAlertsConsentParams(
  contactName: string | null | undefined,
  agencyName: string | null | undefined,
): [name: string, agency: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(agencyName?.trim() || BRANDING.name),
  ];
}
