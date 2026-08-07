// The predefined enquiry-status WhatsApp template — the re-engagement
// channel for imported portal leads whose original enquiry
// (MagicBricks / Housing / 99acres) points at a listing that has since
// expired or sold. These leads have never messaged the Engine number,
// so there is no 24-hour window: the pre-approved template is the only
// path that reaches all of them. Same one-click submit flow as
// [[inventory_update]]; pure functions so payload and params are
// unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';

/** Bumped once — Meta will not re-review an approved template in
 *  place, so each category fix needs a new name:
 *    property_enquiry_followup → submitted as Utility, approved as
 *      Marketing: the "Start deal alerts" opt-in button, "matching
 *      options" phrasing and the STOP-ALERTS footer read as
 *      promotional, and since April 2025 a failed utility submission
 *      is approved as MARKETING instead of rejected (so sends die
 *      with 131049 at capped recipients).
 *  This revision is a pure enquiry-status notice: the deal-alert
 *  opt-in is asked free-form AFTER the lead replies (the buyer digest
 *  consent flow handles it once a window is open), where template
 *  categories don't apply. */
export const ENQUIRY_FOLLOWUP_TEMPLATE_NAME = 'property_enquiry_status';

/** Button texts round-trip through the webhook: a tap arrives as
 *  message.button.text, so each label must satisfy the matcher that
 *  drives its action — isPreferenceFlowRequestText for the preference
 *  form, and the exact-match close button that declines alerts. The
 *  template test locks this coupling. */
export const ENQUIRY_FOLLOWUP_UPDATE_BUTTON = 'Update my preferences';
export const ENQUIRY_FOLLOWUP_CLOSE_BUTTON = 'Close my enquiry';

export function buildEnquiryFollowupTemplatePayload(): TemplatePayload {
  return {
    name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional AND specific
    // to the recipient's own request. Everything here is worded as
    // administration of the enquiry the lead themselves filed: no
    // opt-in ask, no "options"/"deals" vocabulary, no opt-out footer
    // (that alone reads as marketing), no emoji ad-card, no persuasive
    // CTA. Same reasoning as property_enquiry_response.
    category: 'Utility',
    language: 'en_US',
    // Single variable so a send can never fail on a missing per-contact
    // value — the greeting name always resolves (placeholder-safe).
    body_text: [
      'Hi {{1}}, this is a status update on your property enquiry:',
      '',
      'The listing you enquired about is no longer available, so your enquiry cannot be fulfilled as filed.',
      '',
      'To keep your enquiry open, update your requirement below or reply with what you are looking for now. To end it, choose "Close my enquiry" and no further updates will be sent.',
    ].join('\n'),
    buttons: [
      { type: 'QUICK_REPLY', text: ENQUIRY_FOLLOWUP_UPDATE_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_FOLLOWUP_CLOSE_BUTTON },
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
