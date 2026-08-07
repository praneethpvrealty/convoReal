// The predefined "property_enquiry_notice" WhatsApp template — the
// property-anchored re-engagement message, third attempt.
//
// This is deliberately property_enquiry_status's approved copy with ONE
// change: a "Property: {{2}}" line naming the listing the lead enquired
// about. Everything else — the surrounding sentences, the two buttons —
// is byte-for-byte what Meta already classified as Utility.
//
// The history that dictates that discipline, all on one account:
//
//   property_enquiry_followup   Utility -> Marketing.  Had a "Start
//                               deal alerts" opt-in button and an
//                               opt-out footer.
//   buyer_alerts_consent        Utility -> Marketing.  Asked "would you
//                               like updates?" with no price, no emoji
//                               and no promotional language at all.
//   property_enquiry_status     Utility.               Status notice,
//                               buttons "Update my preferences" /
//                               "Close my enquiry".
//   property_enquiry_response   Utility.               "the details you
//   property_enquiry_photos     Utility.               requested", both
//                               with labelled Property/Details/Location
//                               fields, a price, and an image.
//   property_enquiry_update     Utility -> Marketing.  Same shape as
//                               _status plus a "Send listings" button.
//
// Labelled property fields are therefore proven safe (_response,
// _photos). What is not safe is a promotional button: "Send more
// details" elaborates the transaction in hand and passes, while "Send
// listings" and "Start alerts" offer new inventory and do not. So this
// template names the property and offers nothing — a plain reply
// already opens the 24-hour window, after which listings, photos and
// full details go out free-form with no template and no category at
// all.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { Property } from '@/types';

export const ENQUIRY_NOTICE_TEMPLATE_NAME = 'property_enquiry_notice';

/** The two buttons property_enquiry_status was approved with, kept
 *  verbatim. Each still round-trips through its webhook parser, and the
 *  template test locks that. */
export const ENQUIRY_NOTICE_UPDATE_BUTTON = 'Update my preferences';
export const ENQUIRY_NOTICE_CLOSE_BUTTON = 'Close my enquiry';

export function buildEnquiryNoticeTemplatePayload(): TemplatePayload {
  return {
    name: ENQUIRY_NOTICE_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, this is a status update on your property enquiry:',
      '',
      'Property: {{2}}',
      '',
      'The listing you enquired about is no longer available, so your enquiry cannot be fulfilled as filed.',
      '',
      'To keep your enquiry open, update your requirement below or reply with what you are looking for now. To end it, choose "Close my enquiry" and no further updates will be sent.',
    ].join('\n'),
    buttons: [
      { type: 'QUICK_REPLY', text: ENQUIRY_NOTICE_UPDATE_BUTTON },
      { type: 'QUICK_REPLY', text: ENQUIRY_NOTICE_CLOSE_BUTTON },
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
export function buildEnquiryNoticeParams(
  contactName: string | null | undefined,
  enquired: Property
): [name: string, property: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [sanitizeTemplateParam(firstName), describeEnquiredProperty(enquired)];
}
