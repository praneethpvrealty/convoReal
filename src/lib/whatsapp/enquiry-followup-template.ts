// The predefined "property_enquiry_followup" WhatsApp template — the
// re-engagement channel for imported portal leads whose original
// enquiry (MagicBricks / Housing / 99acres) points at a listing that
// has since expired or sold. These leads have never messaged the
// Engine number, so there is no 24-hour window: the pre-approved
// template is the only path that reaches all of them. Same one-click
// submit flow as [[inventory_update]]; pure functions so payload and
// params are unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';

export const ENQUIRY_FOLLOWUP_TEMPLATE_NAME = 'property_enquiry_followup';

/** Button texts round-trip through the webhook parsers: a tap arrives
 *  as message.button.text, so each label must satisfy the matcher that
 *  drives its action — isPreferenceFlowRequestText for the preference
 *  form, parseBuyerAlertsCommand for the alert consent toggles. The
 *  template test locks this coupling. */
export const ENQUIRY_FOLLOWUP_UPDATE_BUTTON = 'Update my preferences';
export const ENQUIRY_FOLLOWUP_SUBSCRIBE_BUTTON = 'Start deal alerts';
export const ENQUIRY_FOLLOWUP_STOP_BUTTON = 'Stop alerts';

export function buildEnquiryFollowupTemplatePayload(): TemplatePayload {
  return {
    name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional AND specific
    // to the recipient's own request — this is a status update on the
    // enquiry the lead themselves filed on a portal. No emoji ad-card,
    // no persuasive CTA ("don't miss out"): mixed utility+marketing
    // content is approved as Marketing since April 2025 and then dies
    // with 131049 at capped recipients. Same reasoning as
    // property_enquiry_response.
    category: 'Utility',
    language: 'en_US',
    // Single variable so a send can never fail on a missing per-contact
    // value — the greeting name always resolves (placeholder-safe).
    body_text: [
      'Hi {{1}}, this is a status update on your earlier property enquiry:',
      '',
      'The listing you enquired about is no longer active in our current catalog.',
      '',
      'Your requirement is still on file with us. Please choose an option below, or reply with your latest requirement, and we will keep your enquiry active with matching options only.',
    ].join('\n'),
    footer_text: 'Reply STOP ALERTS anytime to opt out',
    buttons: [
      { type: 'QUICK_REPLY', text: ENQUIRY_FOLLOWUP_UPDATE_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_FOLLOWUP_SUBSCRIBE_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_FOLLOWUP_STOP_BUTTON },
    ],
    sample_values: {
      body: ['Praneeth'],
    },
  };
}

/**
 * Body param {{1}}: first name, guaranteed non-empty (Meta rejects
 * empty values). A lead filed under "Housing Lead" is greeted "there",
 * never "Housing".
 */
export function buildEnquiryFollowupParams(
  contactName: string | null | undefined
): [name: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [sanitizeTemplateParam(firstName)];
}
