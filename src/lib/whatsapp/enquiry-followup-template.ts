// The predefined enquiry-status WhatsApp template — the re-engagement
// channel for imported portal leads whose original enquiry
// (MagicBricks / Housing / 99acres) points at a listing that has since
// expired or sold. These leads have never messaged the Engine number,
// so there is no 24-hour window: the pre-approved template is the only
// path that reaches all of them. Same one-click submit flow as
// [[inventory_update]]; pure functions so payload and params are
// unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { DEFAULT_LANGUAGE, metaLanguageCode, type LanguageCode } from '@/lib/languages';
import { templateBody, templateButtonLabel } from '@/lib/whatsapp/template-copy';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { BRANDING } from '@/config/branding';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

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
/**
 * Bumped again — this time for trust, not for category.
 *
 * property_enquiry_status names nobody. It goes to imported portal
 * leads who have NEVER messaged this number, so it arrives from an
 * unknown sender claiming to know about "your property enquiry" —
 * which is exactly the shape of a scam. WhatsApp does show the
 * business display name in the header, but a lead who enquired on
 * MagicBricks weeks ago has no reason to connect that name to this
 * message, and a recipient who does not trust it does not reply: they
 * report or block, and the WABA quality rating pays for it.
 *
 * So the brokerage identifies itself in the opening line, where trust
 * is decided rather than after the ask. Naming the sender is
 * administrative, not promotional — it is the opposite of the
 * anonymity Meta's spam rules exist to catch — but it is still a
 * content change, and Meta will not re-review in place. Hence a new
 * name, with the approved one kept as the fallback until this clears.
 */
export const ENQUIRY_FOLLOWUP_TEMPLATE_NAME = 'enquiry_status_notice';

/** Earlier names, newest first. Approved and still sending. */
export const LEGACY_ENQUIRY_FOLLOWUP_TEMPLATE_NAMES = [
  'property_enquiry_status',
];

export const ENQUIRY_FOLLOWUP_TEMPLATE_NAMES = [
  ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
  ...LEGACY_ENQUIRY_FOLLOWUP_TEMPLATE_NAMES,
];

/** How many body params a given name expects — the signed revision
 *  carries the brokerage name, the legacy one does not, and a send
 *  with the wrong count is rejected by Meta. */
export function enquiryFollowupParamCount(templateName: string): 1 | 2 {
  return templateName === ENQUIRY_FOLLOWUP_TEMPLATE_NAME ? 2 : 1;
}

export function pickEnquiryFollowupTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
): T | null {
  return pickApprovedTemplate(rows, ENQUIRY_FOLLOWUP_TEMPLATE_NAMES);
}

/** Button texts round-trip through the webhook: a tap arrives as
 *  message.button.text, so each label must satisfy the matcher that
 *  drives its action — isPreferenceFlowRequestText for the preference
 *  form, and the exact-match close button that declines alerts. The
 *  template test locks this coupling. */
export const ENQUIRY_FOLLOWUP_UPDATE_BUTTON = 'Update my preferences';
export const ENQUIRY_FOLLOWUP_CLOSE_BUTTON = 'Close my enquiry';

export function buildEnquiryFollowupTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE,
): TemplatePayload {
  return {
    name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional AND specific
    // to the recipient's own request. Everything here is worded as
    // administration of the enquiry the lead themselves filed: no
    // opt-in ask, no "options"/"deals" vocabulary, no opt-out footer
    // (that alone reads as marketing), no emoji ad-card, no persuasive
    // CTA. Same reasoning as property_enquiry_response.
    category: 'Utility',
    language: metaLanguageCode(language),
    // Single variable so a send can never fail on a missing per-contact
    // value — the greeting name always resolves (placeholder-safe).
    body_text: templateBody('enquiry_followup', language),
    buttons: [
      { type: 'QUICK_REPLY', text: templateButtonLabel('update_preferences', language) },
      { type: 'QUICK_REPLY', text: templateButtonLabel('close_enquiry', language) },
    ],
    sample_values: {
      body: ['Praneeth', 'Aryavarta Ventures'],
    },
  };
}

/**
 * Body params {{1}} first name, {{2}} the brokerage sending it. Both
 * guaranteed non-empty (Meta rejects empty values). A lead filed under
 * "Housing Lead" is greeted "there", never "Housing"; an account with
 * no name set falls back to the product name rather than sending a
 * message signed by nobody.
 */
export function buildEnquiryFollowupParams(
  contactName: string | null | undefined,
  brandName?: string | null
): [name: string, brand: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
  ];
}
