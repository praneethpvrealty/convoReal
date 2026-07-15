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

export const PROPERTY_ALERT_TEMPLATE_NAME = 'new_property_alert';

export function buildPropertyAlertTemplatePayload(origin: string): TemplatePayload {
  return {
    name: PROPERTY_ALERT_TEMPLATE_NAME,
    category: 'Marketing',
    language: 'en_US',
    body_text: [
      '🏠 *New Property Match*',
      '',
      'Hi {{1}}! A listing that fits what you were looking for just came up:',
      '',
      '*{{2}}*',
      '{{3}}',
      '📍 {{4}}',
      '',
      'Want photos, the exact location, or a site visit? Just reply to this message — I answer personally on this number.',
    ].join('\n'),
    footer_text: 'Reply STOP to unsubscribe',
    buttons: [
      // Quick replies first (Meta rule). A tap opens the 24h window, so
      // the follow-up conversation continues free-form in the CRM Inbox.
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
