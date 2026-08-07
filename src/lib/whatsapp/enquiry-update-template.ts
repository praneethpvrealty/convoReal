// The predefined "property_enquiry_update" WhatsApp template — the
// property-anchored re-engagement message.
//
// property_enquiry_status says only "your earlier property enquiry",
// which reads as a form letter. This one names the listing the lead
// actually enquired about, which is the whole difference between a
// message they recognise and one they ignore.
//
// It deliberately volunteers NOTHING. Four approvals on this account
// draw the line clearly: "the details you requested"
// (property_enquiry_response) and "the photos you requested"
// (property_enquiry_photos) are Utility even carrying a price and an
// image, while property_enquiry_followup and buyer_alerts_consent were
// both re-filed as Marketing for offering something the recipient had
// not asked for — the latter with no price, no emoji and no
// promotional language at all. So the classifier is not reading
// vocabulary, it is reading whether the message is unsolicited.
//
// An earlier draft of this template named a replacement listing inline.
// That is the Marketing side of the same line, so the substitute moved
// behind the "Send listings" button: the tap is the request, which both
// makes the follow-up honest and opens the 24-hour window.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { Property } from '@/types';

export const ENQUIRY_UPDATE_TEMPLATE_NAME = 'property_enquiry_update';

/** Button texts round-trip through the webhook parsers, so each label
 *  must satisfy the matcher that drives its action:
 *    "Send listings"         -> parseBuyerMatchesCommand
 *    "Update my preferences" -> isPreferenceFlowRequestText
 *    "Close my enquiry"      -> exact match in the webhook handler
 *  The template test locks all three. */
export const ENQUIRY_UPDATE_LISTINGS_BUTTON = 'Send listings';
export const ENQUIRY_UPDATE_PREFERENCES_BUTTON = 'Update my preferences';
export const ENQUIRY_UPDATE_CLOSE_BUTTON = 'Close my enquiry';

export function buildEnquiryUpdateTemplatePayload(): TemplatePayload {
  return {
    name: ENQUIRY_UPDATE_TEMPLATE_NAME,
    // Utility: a status notice on the recipient's own enquiry, in the
    // labelled transaction-notice shape both approved enquiry
    // templates use. Nothing is offered that was not asked for.
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, an update on your property enquiry:',
      '',
      'Property: {{2}}',
      'Status: No longer available',
      '',
      'Reply to this message with what you are looking for now and we will keep your enquiry open.',
    ].join('\n'),
    buttons: [
      { type: 'QUICK_REPLY', text: ENQUIRY_UPDATE_LISTINGS_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_UPDATE_PREFERENCES_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_UPDATE_CLOSE_BUTTON },
    ],
    sample_values: {
      body: ['Praneeth', '3 BHK at Prestige Lakeside Habitat, Whitefield'],
    },
  };
}

/** "3 BHK at Prestige Lakeside Habitat, Whitefield" — enough for the
 *  lead to recognise their own enquiry at a glance. */
export function describeEnquiredProperty(property: Property): string {
  const title = property.title?.trim() || 'your enquiry';
  const bhk =
    property.bedrooms && property.bedrooms > 0
      ? `${property.bedrooms} BHK at `
      : '';
  const locality =
    [property.sublocality?.trim(), property.city?.trim()]
      .filter(Boolean)
      .join(', ') ||
    property.location?.trim() ||
    '';
  return sanitizeTemplateParam(
    `${bhk}${title}${locality ? `, ${locality}` : ''}`
  );
}

/**
 * Body params {{1}}..{{2}}: first name and the enquired property. Both
 * are guaranteed non-empty — Meta rejects empty values.
 */
export function buildEnquiryUpdateParams(
  contactName: string | null | undefined,
  enquired: Property
): [name: string, property: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [sanitizeTemplateParam(firstName), describeEnquiredProperty(enquired)];
}
