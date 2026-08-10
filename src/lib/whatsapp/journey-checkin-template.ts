// The predefined "enquiry check-in" WhatsApp template — the journey
// sheet's still-in-play question for a branch whose 24-hour window has
// closed.
//
// Why a new template rather than an existing one: no approved Utility
// template can carry this message honestly. listing_status_notice and
// enquiry_status_notice assert the listing is *no longer available*,
// which is false for a live shortlisted property; listing_details_notice
// and property_enquiry_response deliver details rather than ask a
// question; call_update's fixed framing claims a call that did not
// happen. Reuse would mean sending a statement that is not true.
//
// Why it should classify as Utility: Meta's two-part test is
// non-promotional AND specific to the recipient's own request. This is
// administration of an enquiry the lead themselves filed — no opt-in
// ask, no "options"/"deals" vocabulary, no opt-out footer, no emoji
// ad-card, no persuasive CTA. Same reasoning that holds UTILITY for
// listing_status_notice and listing_photos_notice.
//
// The free-form wording that goes out inside an open window says
// "should I park it and focus on other options?" — "options" is exactly
// the vocabulary that reads as promotional at review, so the template
// asks the same question without it.
//
// Pure functions so payload and params are unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { BRANDING } from '@/config/branding';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

export const JOURNEY_CHECKIN_TEMPLATE_NAME = 'enquiry_checkin_notice';

export const JOURNEY_CHECKIN_TEMPLATE_NAMES = [JOURNEY_CHECKIN_TEMPLATE_NAME];

export function pickJourneyCheckinTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
): T | null {
  return pickApprovedTemplate(rows, JOURNEY_CHECKIN_TEMPLATE_NAMES);
}

/** Button texts round-trip through the webhook as message.button.text.
 *  The close label is shared verbatim with the two enquiry templates so
 *  one handler covers all three; the template test locks it. */
export const JOURNEY_CHECKIN_KEEP_BUTTON = 'Still considering it';
export const JOURNEY_CHECKIN_CLOSE_BUTTON = 'Close my enquiry';

export function buildJourneyCheckinTemplatePayload(
  origin: string,
): TemplatePayload {
  const base = origin.replace(/\/+$/, '');
  return {
    name: JOURNEY_CHECKIN_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, this is a check-in on your property enquiry with {{2}}:',
      '',
      'Property: {{3}}',
      '',
      'We have had no update from you on this listing, so your enquiry is still open against it.',
      '',
      'Reply to confirm it is still under consideration. To end the enquiry, choose "Close my enquiry" and no further updates will be sent.',
    ].join('\n'),
    buttons: [
      // The quick replies open the 24h window; the URL carries the
      // listing itself, the same suffix shape listing_details_notice
      // was approved with.
      { type: 'QUICK_REPLY', text: JOURNEY_CHECKIN_KEEP_BUTTON },
      { type: 'QUICK_REPLY', text: JOURNEY_CHECKIN_CLOSE_BUTTON },
      {
        type: 'URL',
        text: 'View full details',
        url: `${base}/{{1}}`,
        example: '?property_id=abc&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
      ],
    },
  };
}

/**
 * The URL button's suffix: everything after the account's showcase
 * origin. Must match the shape the template was reviewed with
 * (`?property_id=abc&v=contact-id`), and `v=` attributes the visit to
 * this contact in Pulse rather than gating anything.
 */
export function journeyCheckinUrlSuffix(
  property: { id: string; property_code?: string | null },
  contactId: string,
): string {
  const id = property.property_code || property.id;
  return `?property_id=${encodeURIComponent(id)}&v=${encodeURIComponent(contactId)}`;
}

/**
 * Body params {{1}}..{{3}}: first name, the brokerage sending it, and
 * the listing being checked on. All three are guaranteed non-empty —
 * Meta rejects empty values, a lead filed under "Housing Lead" is
 * greeted "there" rather than "Housing", and an account with no name
 * set falls back to the product name rather than sending unsigned.
 */
export function buildJourneyCheckinParams(
  contactName: string | null | undefined,
  brandName: string | null | undefined,
  propertyDescription: string,
): [name: string, brand: string, property: string] {
  const raw = contactName?.trim() ?? '';
  const firstName =
    raw && !isPlaceholderLeadName(raw) ? raw.split(/\s+/)[0] : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(propertyDescription) || 'your enquiry',
  ];
}
