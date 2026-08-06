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

/** Bumped from `new_property_alert` when the category moved to Utility:
 *  Meta will not re-categorise an already-approved template in place, so
 *  the new category needs a new name to go through review. Accounts still
 *  holding the approved Marketing original keep it until they run the
 *  one-click setup again. */
export const PROPERTY_ALERT_TEMPLATE_NAME = 'property_enquiry_details';

export function buildPropertyAlertTemplatePayload(origin: string): TemplatePayload {
  return {
    name: PROPERTY_ALERT_TEMPLATE_NAME,
    // Utility, not Marketing. This answers a person who asked about a
    // property — on a portal, on the showcase, or by giving an agent
    // their brief — rather than broadcasting to a list. Marketing
    // templates are also subject to Meta's per-user frequency cap, which
    // silently drops them with error 131049 for anyone at their limit;
    // Utility is exempt. Same reasoning as location_reveal.
    category: 'Utility',
    language: 'en_US',
    // Worded as a reply to a request, because that is what Meta's
    // reviewers categorise on. Promotional framing ("just came up",
    // "don't miss out") reads as Marketing however the category is set.
    body_text: [
      '🏠 *Property details you asked for*',
      '',
      'Hi {{1}}, here are the details of the property matching your enquiry:',
      '',
      '*{{2}}*',
      '{{3}}',
      '📍 {{4}}',
      '',
      'Reply to this message for photos, the exact location, or to arrange a site visit — I answer personally on this number.',
    ].join('\n'),
    buttons: [
      // Quick replies first (Meta rule). A tap opens the 24h window, so
      // the follow-up conversation continues free-form in the Engine Inbox.
      { type: 'QUICK_REPLY', text: 'Send photos & details' },
      { type: 'QUICK_REPLY', text: 'Book a site visit' },
      {
        type: 'URL',
        text: 'View property',
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: '?property_id=abc&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Gopi',
        'Premium Commercial Property for Sale in Hoodi, Bangalore',
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
 * Body params {{1}}..{{4}}: first name, title, specs line, locality.
 * Every param is guaranteed non-empty (Meta rejects empty values).
 */
export function buildPropertyAlertParams(
  contactName: string | null | undefined,
  property: Property,
): [name: string, title: string, specs: string, location: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const location =
    [property.sublocality?.trim(), property.city?.trim()].filter(Boolean).join(', ') ||
    property.location?.trim() ||
    'Location shared on request';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(property.title.trim() || 'New listing'),
    sanitizeTemplateParam(specsSegment(property) || 'Details on request'),
    sanitizeTemplateParam(location),
  ];
}
