// The predefined "new_property_alert" WhatsApp template — Match Radar's
// template-first channel. Radar alerts go to matched buyers who almost
// never have an open 24-hour service window (they haven't messaged us in
// the last day), so the pre-approved template is the PRIMARY path and
// free-form is the opportunistic upgrade when a window happens to be
// open. Same one-click submit flow as [[inventory_update]]; pure
// functions so payload and params are unit-testable.

import type { Property } from '@/types';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { formatShareAmount } from '@/lib/share-message-builder';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { SEND_MORE_DETAILS_BUTTON } from '@/lib/whatsapp/template-quick-replies';
import { BRANDING } from '@/config/branding';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

/**
 * Bumped four times. Meta will not re-review an approved template in
 * place, so every fix needs a name it has not ruled on:
 *
 *   new_property_alert        → approved as Marketing (submitted as such)
 *   property_enquiry_details  → submitted as Utility, but Meta's
 *     classifier approved it as Marketing anyway (since April 2025 a
 *     utility submission that fails the utility test is approved as
 *     MARKETING instead of rejected), so sends died with 131049.
 *   property_enquiry_response → approved as Utility, and still working.
 *     Its URL button carries the DASHBOARD host, because every builder
 *     caller is a client component with only window.location.origin to
 *     offer, so a brokerage with its own subdomain sends buyers to the
 *     shared showcase. Now corrected at submission — but correcting
 *     THIS row means an edit, and an edit is a fresh review that could
 *     land it in Marketing permanently.
 *
 *   property_enquiry_info    → approved as Utility WITH the brokerage's
 *     own subdomain on its button. Working, and still unsigned: the
 *     body names nobody, so a buyer who enquired weeks ago gets
 *     property details from a number they do not recognise.
 *
 * So each fix ships under a name Meta has not ruled on, and the
 * previous one keeps sending untouched meanwhile. If Meta classifies
 * the new one Marketing it is simply never selected — see
 * pickApprovedTemplate, where category outranks name. Nothing is
 * risked to gain a signature.
 */
export const PROPERTY_ALERT_TEMPLATE_NAME = 'listing_details_notice';

/** Earlier names, newest first. An account holding an approved row
 *  under any of these keeps sending from it until the current name
 *  clears review. */
export const LEGACY_PROPERTY_ALERT_TEMPLATE_NAMES = [
  'property_enquiry_info',
  'property_enquiry_response',
  'property_enquiry_details',
  'new_property_alert',
];

export const PROPERTY_ALERT_TEMPLATE_NAMES = [
  PROPERTY_ALERT_TEMPLATE_NAME,
  ...LEGACY_PROPERTY_ALERT_TEMPLATE_NAMES,
];

export type PropertyAlertCandidate = ApprovedTemplateCandidate;

/** The text-only property-details template a send should use — see
 *  pickApprovedTemplate for why category outranks name. */
export function pickPropertyAlertTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[]
): T | null {
  return pickApprovedTemplate(rows, PROPERTY_ALERT_TEMPLATE_NAMES);
}

export function buildPropertyAlertTemplatePayload(origin: string): TemplatePayload {
  return {
    name: PROPERTY_ALERT_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional AND specific
    // to the recipient's own request. Marketing templates are silently
    // dropped with error 131049 for any recipient at their per-user
    // cap; Utility is exempt. Same reasoning as location_reveal.
    category: 'Utility',
    language: 'en_US',
    // Worded as fulfilment of the recipient's enquiry: labelled fields
    // like a transaction notice, no emoji/bold ad-card, no persuasive
    // CTA ("book a site visit", "don't miss out"). Mixed
    // utility+marketing content classifies the whole template as
    // Marketing regardless of the submitted category.
    body_text: [
      'Hi {{1}}, here are the details for your property enquiry with {{2}}:',
      '',
      'Property: {{3}}',
      'Details: {{4}}',
      'Location: {{5}}',
      '',
      'Reply to this message if you need any further information about this enquiry.',
    ].join('\n'),
    buttons: [
      // Quick reply first (Meta rule). A tap opens the 24h window, so
      // the follow-up conversation continues free-form in the Engine
      // Inbox; the URL carries the requested listing details.
      { type: 'QUICK_REPLY', text: SEND_MORE_DETAILS_BUTTON },
      {
        type: 'URL',
        text: 'View full details',
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: '?property_id=abc&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Gopi',
        'Aryavarta Ventures',
        'Commercial Property for Sale in Hoodi, Bangalore',
        '₹32 Cr · 23,500 Sq.Ft.',
        'Hoodi, Bangalore',
      ],
    },
  };
}

function specsSegment(p: Property): string {
  const bits: string[] = [];
  if (p.listing_type === 'Rent') {
    const rent = formatShareAmount(p.rent_per_month);
    if (rent) bits.push(`${rent}/mo rent`);
  } else {
    const price = formatShareAmount(p.price);
    if (price) bits.push(price);
  }
  if (p.land_area && p.land_area > 0) {
    bits.push(`${p.land_area.toLocaleString('en-IN')} ${p.land_area_unit || 'Sq.Ft.'}`);
  } else if (p.area_sqft && p.area_sqft > 0) {
    bits.push(`${p.area_sqft.toLocaleString('en-IN')} ${p.area_unit || 'Sq.Ft.'}`);
  }
  if (p.bedrooms && p.bedrooms > 0) bits.push(`${p.bedrooms} BHK`);
  return bits.join(' · ');
}

/**
 * Body params {{1}}..{{5}}: first name, the brokerage sending it,
 * title, specs line, locality. Every param is guaranteed non-empty
 * (Meta rejects empty values), and an account with no name set falls
 * back to the product name rather than sending unsigned.
 *
 * The legacy names carry four of these — see propertyShareParams,
 * which drops the brokerage for them rather than sending a spare Meta
 * would reject.
 */
export function buildPropertyAlertParams(
  contactName: string | null | undefined,
  property: Property,
  brandName?: string | null,
): [name: string, brand: string, title: string, specs: string, location: string] {
  // A lead filed under "Housing Lead" would be greeted "Hi Housing," —
  // the placeholder is a filing name, never a form of address.
  const firstName = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  const location =
    [property.sublocality?.trim(), property.city?.trim()].filter(Boolean).join(', ') ||
    property.location?.trim() ||
    'Location shared on request';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(property.title.trim() || 'New listing'),
    sanitizeTemplateParam(specsSegment(property) || 'Details on request'),
    sanitizeTemplateParam(location),
  ];
}
