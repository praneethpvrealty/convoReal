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

/** Bumped twice — Meta will not re-review an approved template in
 *  place, so each category fix needs a new name:
 *    new_property_alert        → approved as Marketing (submitted as such)
 *    property_enquiry_details  → submitted as Utility, but Meta's
 *      classifier approved it as Marketing anyway (since April 2025 a
 *      utility submission that fails the utility test is approved as
 *      MARKETING instead of rejected), so sends died with 131049.
 *  Accounts holding an older approved variant keep it until they run
 *  the one-click setup again. */
export const PROPERTY_ALERT_TEMPLATE_NAME = 'property_enquiry_response';

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
      'Hi {{1}}, here are the details for your property enquiry:',
      '',
      'Property: {{2}}',
      'Details: {{3}}',
      'Location: {{4}}',
      '',
      'Reply to this message if you need any further information about this enquiry.',
    ].join('\n'),
    buttons: [
      // Quick reply first (Meta rule). A tap opens the 24h window, so
      // the follow-up conversation continues free-form in the Engine
      // Inbox; the URL carries the requested listing details.
      { type: 'QUICK_REPLY', text: 'Send more details' },
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
