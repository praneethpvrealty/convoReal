// The predefined "inventory_update" WhatsApp template + its per-send
// parameter builders. This is the CRM-native counterpart of the
// showcase share dialog's inventory digest: instead of pasting the
// digest into personal WhatsApp, the agent sends this pre-approved
// Marketing template from their WhatsApp Business number, so replies
// land in the ConvoReal Inbox (24h window opens → AI copilot engages,
// everything is tracked). One-click submitted via
// /api/whatsapp/templates/submit; pure functions so the exact payload
// and parameters are unit-testable.

import type { Property } from '@/types';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { formatShareAmount } from '@/lib/share-message-builder';
import { categoryForType } from '@/lib/inventory-summary-builder';

export const INVENTORY_UPDATE_TEMPLATE_NAME = 'inventory_update';

// Meta rejects body parameters containing newlines, tabs, or 4+
// consecutive spaces; the rendered body must also stay inside the
// 1024-char cap, so each category line gets a hard budget.
const PARAM_MAX_LENGTH = 200;

export function sanitizeTemplateParam(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > PARAM_MAX_LENGTH ? `${clean.slice(0, PARAM_MAX_LENGTH - 1)}…` : clean;
}

/**
 * Template definition submitted to Meta. `origin` becomes the URL
 * button's base (the tenant's own showcase domain); the dynamic
 * suffix carries `?ref=<account>&v=<contact>` at send time so every
 * click is attributed by name in Showcase Pulse.
 */
export function buildInventoryUpdateTemplatePayload(origin: string): TemplatePayload {
  return {
    name: INVENTORY_UPDATE_TEMPLATE_NAME,
    category: 'Marketing',
    language: 'en_US',
    body_text: [
      '🏠 *New Inventory Update*',
      '',
      "Hi {{1}}! We've just refreshed our property catalog. Quick snapshot:",
      '',
      '🏡 Residential: {{2}}',
      '',
      '🏢 Commercial: {{3}}',
      '',
      '🌾 Farm & land: {{4}}',
      '',
      'Reply to this message for photos, exact locations, or to book a site visit — I answer personally on this number.',
    ].join('\n'),
    footer_text: 'Reply STOP to unsubscribe',
    buttons: [
      // Quick replies first (Meta: QR block cannot follow CTA buttons).
      // A tap opens the 24h service window → the full digest / copilot
      // conversation continues free-form inside ConvoReal.
      { type: 'QUICK_REPLY', text: 'Send full list 📋' },
      { type: 'QUICK_REPLY', text: 'Book a site visit' },
      {
        type: 'URL',
        text: 'Browse showcase',
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: '?ref=account-id&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        '3 options — Golden City (Plot · ₹44.40 Lakhs), Sumadhura Eden Garden (2.5 BHK · ₹1.70 Cr) +1 more',
        '2 options — Prestige Office (₹6.30 Lakhs/mo rent), Oval Reef Warehouse (₹9 Cr · ROI 6%)',
        'Green Acres (4 Acres · ₹5.20 Cr)',
      ],
    },
  };
}

function itemLabel(p: Property): string {
  const bits: string[] = [];
  if (p.bedrooms && p.bedrooms > 0) bits.push(`${p.bedrooms} BHK`);
  if (p.listing_type === 'Rent') {
    const rent = formatShareAmount(p.rent_per_month);
    if (rent) bits.push(`${rent}/mo rent`);
  } else {
    const price = formatShareAmount(p.price);
    if (price) bits.push(price);
    if (p.roi && p.roi > 0) bits.push(`ROI ${p.roi}%`);
  }
  return bits.length > 0 ? `${p.title.trim()} (${bits.join(' · ')})` : p.title.trim();
}

function categoryLine(list: Property[]): string {
  if (list.length === 0) return 'fresh stock arriving — ask me for a preview';
  const shown = list.slice(0, 2).map(itemLabel).join(', ');
  const more = list.length - Math.min(list.length, 2);
  const counted = `${list.length} option${list.length === 1 ? '' : 's'} — ${shown}`;
  return sanitizeTemplateParam(more > 0 ? `${counted} +${more} more` : counted);
}

/**
 * Body params {{2}}..{{4}}: one single-line snapshot per section.
 * Agricultural and anything uncategorised share the third line.
 */
export function buildInventoryUpdateParams(
  properties: Property[],
): [residential: string, commercial: string, farmAndLand: string] {
  const residential: Property[] = [];
  const commercial: Property[] = [];
  const farmAndLand: Property[] = [];
  for (const p of properties) {
    const cat = categoryForType(p.type);
    if (cat === 'Residential') residential.push(p);
    else if (cat === 'Commercial') commercial.push(p);
    else farmAndLand.push(p);
  }
  return [categoryLine(residential), categoryLine(commercial), categoryLine(farmAndLand)];
}
