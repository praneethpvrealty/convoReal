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
import { BRANDING } from '@/config/branding';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

/**
 * Bumped once, in step with enquiry_status_notice and for the same
 * reason: property_enquiry_notice names nobody, and it reaches leads
 * who have never messaged this number. The brokerage now identifies
 * itself in the opening line.
 *
 * The parity discipline in the header above still holds — this stays
 * the status notice's copy plus one property line, and the test locks
 * that. Both templates gained {{2}} together so the delta between them
 * is still exactly the property.
 */
export const ENQUIRY_NOTICE_TEMPLATE_NAME = 'listing_status_notice';

/** Earlier names, newest first. Approved and still sending. */
export const LEGACY_ENQUIRY_NOTICE_TEMPLATE_NAMES = [
  'property_enquiry_notice',
];

export const ENQUIRY_NOTICE_TEMPLATE_NAMES = [
  ENQUIRY_NOTICE_TEMPLATE_NAME,
  ...LEGACY_ENQUIRY_NOTICE_TEMPLATE_NAMES,
];

/** 2 for the legacy name (name + property), 3 for the signed revision
 *  (name + brokerage + property). A send with the wrong count is
 *  rejected by Meta. */
export function enquiryNoticeParamCount(templateName: string): 2 | 3 {
  return templateName === ENQUIRY_NOTICE_TEMPLATE_NAME ? 3 : 2;
}

export function pickEnquiryNoticeTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
): T | null {
  return pickApprovedTemplate(rows, ENQUIRY_NOTICE_TEMPLATE_NAMES);
}

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
      'Hi {{1}}, this is a status update on your property enquiry with {{2}}:',
      '',
      'Property: {{3}}',
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
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
      ],
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
 * Body params {{1}}..{{3}}: first name, the brokerage sending it, and
 * the enquired property. All three are guaranteed non-empty — Meta
 * rejects empty values, and an unsigned message is the problem the
 * brokerage param exists to fix.
 */
export function buildEnquiryNoticeParams(
  contactName: string | null | undefined,
  enquired: Property,
  brandName?: string | null
): [name: string, brand: string, property: string] {
  return buildEnquiryNoticeTextParams(
    contactName,
    describeEnquiredProperty(enquired),
    brandName
  );
}

/**
 * Same params from a textual description of the enquiry — used when
 * the enquired listing never existed in inventory but the portal's own
 * wording of the requirement did survive the import.
 */
export function buildEnquiryNoticeTextParams(
  contactName: string | null | undefined,
  description: string,
  brandName?: string | null
): [name: string, brand: string, property: string] {
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(description),
  ];
}
