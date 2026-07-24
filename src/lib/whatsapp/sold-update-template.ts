// The predefined "property_sold_update" WhatsApp template — the sold
// notification's template-first channel. Interested buyers rarely have an
// open 24-hour service window when a listing sells, so the pre-approved
// template is the PRIMARY path and free-form is the opportunistic upgrade
// when a window happens to be open (same strategy as new_property_alert).
// Pure functions so payload and params are unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const SOLD_UPDATE_TEMPLATE_NAME = 'property_sold_update';

export function buildSoldUpdateTemplatePayload(): TemplatePayload {
  return {
    name: SOLD_UPDATE_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      '🔔 *Update on a property you showed interest in*',
      '',
      'Hi {{1}}, the property below is no longer available — it has been sold.',
      '',
      '*{{2}}*',
      '',
      'Tap a button below to know more.',
    ].join('\n'),
    footer_text: 'Reply STOP to unsubscribe',
    buttons: [
      // Quick replies carry a send-time payload (sold_price:<id> /
      // sold_similar:<id>) so a tap routes exactly like the free-form
      // interactive buttons — and opens the 24h window for follow-ups.
      { type: 'QUICK_REPLY', text: 'Check sold price' },
      { type: 'QUICK_REPLY', text: 'Find similar' },
    ],
    sample_values: {
      body: ['Gopi', 'Premium Commercial Property for Sale in Hoodi, Bangalore'],
    },
  };
}

export function buildSoldUpdateParams(
  contactName: string | null | undefined,
  propertyTitle: string
): string[] {
  return [
    sanitizeTemplateParam(contactName?.trim() || 'there'),
    sanitizeTemplateParam(propertyTitle),
  ];
}
