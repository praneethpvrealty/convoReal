// ============================================================
// Property share-message builder — one place that composes the
// outbound "send this listing to someone" text for the share
// dialog. Pure functions so the exact message a client or
// co-broker receives is unit-testable.
//
// Detail levels:
//   quick    — title + price + link (a teaser)
//   standard — headline specs line + price + link
//   complete — every filled field, WhatsApp-formatted, so the
//              recipient needs nothing beyond this one message.
// ============================================================

import type { Property } from '@/types';

export type ShareAudience = 'client' | 'agent';
export type ShareDetailLevel = 'quick' | 'standard' | 'complete';
export type ShareTone = 'professional' | 'casual' | 'friendly';

export interface ShareMessageInput {
  property: Property;
  url: string;
  audience: ShareAudience;
  detail: ShareDetailLevel;
  tone: ShareTone;
  currency?: string;
  agentName?: string;
  agentPhone?: string;
}

const GREETING_HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mstr', 'master', 'dr', 'prof', 'shri', 'sri',
  'smt', 'kum', 'sir', 'madam', 'mx',
]);

/**
 * First name to greet a contact by, skipping a leading honorific so
 * "Mr Jitender Kothari" greets as "Jitender", not "Mr". Falls back to the
 * first token when the name is only an honorific.
 */
export function greetingFirstName(name?: string | null): string | null {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (!GREETING_HONORIFICS.has(t.replace(/\./g, '').toLowerCase())) return t;
  }
  return tokens[0] || null;
}

export function formatShareAmount(amount: number | null | undefined, currency: string = 'INR'): string {
  const n = Number(amount);
  if (!n || isNaN(n) || n <= 0) return '';
  if (currency === 'INR') {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

function priceLine(property: Property, currency: string): string {
  if (property.listing_type === 'Rent' || property.listing_type === 'Built to Suit') {
    const rent = formatShareAmount(property.rent_per_month, currency);
    if (!rent) return 'Price on request';
    const maint = formatShareAmount(property.maintenance, currency);
    return maint ? `${rent}/mo + ${maint} maintenance` : `${rent}/mo`;
  }
  if (property.listing_type === 'JV/JD') {
    if (property.owner_share_percent && property.builder_share_percent) {
      return `JV — Owner ${property.owner_share_percent}% : Builder ${property.builder_share_percent}%`;
    }
    return 'JV/JD — terms on request';
  }
  return formatShareAmount(property.price, currency) || 'Price on request';
}

function locationLine(property: Property): string {
  return (
    [property.sublocality, property.city, property.state].filter(Boolean).join(', ') ||
    property.location ||
    ''
  );
}

function areaLine(property: Property): string {
  const isLand = (property.type || '').includes('Land') || (property.type || '').includes('Plot');
  const val = isLand ? property.land_area : property.area_sqft;
  const unit = isLand ? property.land_area_unit || 'sqft' : property.area_unit || 'sqft';
  return val ? `${val} ${unit}` : '';
}

function specsLine(property: Property): string {
  return [
    property.bedrooms ? `${property.bedrooms} BHK` : '',
    property.type || '',
    areaLine(property),
    locationLine(property),
  ]
    .filter(Boolean)
    .join(' | ');
}

function signOff(input: ShareMessageInput): string {
  const base = input.audience === 'agent' ? 'Regards' : 'Best regards';
  const name = input.agentName ? `${base}, ${input.agentName}` : base;
  return input.agentPhone ? `${name}\n${input.agentPhone}` : name;
}

function intro(input: ShareMessageInput): string {
  if (input.audience === 'agent') {
    return 'Hi,\n\nSharing a listing from my inventory — happy to co-broke. Full specs below; the link has photos, map, and complete details (clean page, no inquiry forms):';
  }
  switch (input.tone) {
    case 'casual':
      return 'Hey!\n\nCheck out this property I found:';
    case 'friendly':
      return 'Hello! 👋\n\nI thought you might be interested in this property:';
    default:
      return 'Hi,\n\nI wanted to share a property listing that might interest you:';
  }
}

function outro(input: ShareMessageInput): string {
  if (input.audience === 'agent') return '';
  switch (input.tone) {
    case 'casual':
      return 'Let me know what you think!';
    case 'friendly':
      return "Happy to help if you'd like to know more!";
    default:
      return 'Feel free to reach out if you have any questions.';
  }
}

/** The "everything in one message" body — every filled field, capped
 *  lists, WhatsApp * formatting. */
function completeBody(property: Property, currency: string): string {
  const lines: string[] = [];
  lines.push(`🏡 *${property.title}*`);
  if (property.project) lines.push(`🏢 ${property.project}`);

  const loc = locationLine(property);
  if (loc) lines.push(`📍 ${loc}`);

  lines.push(`💰 *${priceLine(property, currency)}*`);

  const physical = [
    property.bedrooms ? `${property.bedrooms} BHK` : '',
    property.bathrooms ? `${property.bathrooms} Bath` : '',
    areaLine(property),
    property.super_built_area ? `${property.super_built_area} super built-up` : '',
    property.dimensions || '',
    property.facing_direction ? `${property.facing_direction} facing` : '',
    property.road_width ? `${property.road_width} ${property.road_width_unit || 'ft'} road` : '',
  ].filter(Boolean);
  if (property.type || physical.length > 0) {
    lines.push(`📐 ${[property.type, ...physical].filter(Boolean).join(' · ')}`);
  }

  if (property.listing_type === 'Rent' || property.listing_type === 'Built to Suit') {
    const terms = [
      property.advance ? `Advance ${formatShareAmount(property.advance, currency)}` : '',
      property.gst ? 'GST applicable' : '',
    ].filter(Boolean);
    if (terms.length > 0) lines.push(`📋 ${terms.join(' · ')}`);
  }

  const features = (property.features || []).filter(Boolean).slice(0, 6);
  if (features.length > 0) lines.push(`✨ ${features.join(' | ')}`);

  const highlights = (property.nearby_highlights || []).filter(Boolean).slice(0, 5);
  if (highlights.length > 0) lines.push(`🚩 Nearby: ${highlights.join(' | ')}`);

  if (property.rental_income) {
    lines.push(`📈 Rental income: ${formatShareAmount(property.rental_income, currency)}/mo${property.roi ? ` (~${property.roi}% ROI)` : ''}`);
  }

  if (property.google_map_link) lines.push(`🗺 Map: ${property.google_map_link}`);

  return lines.join('\n');
}

export function buildPropertyShareMessage(input: ShareMessageInput): string {
  const { property, url, detail } = input;
  const currency = input.currency || 'INR';

  if (detail === 'quick') {
    return [
      intro(input),
      `*${property.title}*\n💰 *${priceLine(property, currency)}*`,
      `📸 Photos & full details:\n${url}`,
      [outro(input), signOff(input)].filter(Boolean).join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (detail === 'complete') {
    return [
      intro(input),
      completeBody(property, currency),
      `📸 Photos & full details:\n${url}`,
      [outro(input), signOff(input)].filter(Boolean).join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const specs = specsLine(property);
  return [
    intro(input),
    `*${property.title}*\n${specs ? `${specs}\n` : ''}💰 *${priceLine(property, currency)}*`,
    `📸 Photos & full details:\n${url}`,
    [outro(input), signOff(input)].filter(Boolean).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Append `property_id` to the account's showcase base, preserving any
 *  query params (`?ref=` when there's no subdomain). */
export function propertyShowcaseUrl(baseUrl: string, property: Property): string {
  const id = property.property_code || property.id;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}property_id=${encodeURIComponent(id)}`;
}

/**
 * Post-approval "details reveal" for the lead's own inquiry: the same
 * complete-detail body a 'complete' share carries, plus the exact
 * address and the property's showcase link. Sent through the CRM
 * inside the 24-hour window and via a wa.me deep link outside it.
 */
export function buildInquiryDetailsMessage(input: {
  property: Property;
  url: string;
  currency?: string;
}): string {
  const { property, url } = input;
  const currency = input.currency || 'INR';
  const body = [completeBody(property, currency)];
  if (property.location && locationLine(property) !== property.location) {
    body.push(`📍 *Exact Address:* ${property.location}`);
  }
  return [
    `Here are the complete details for the property "${property.title}" you inquired about:`,
    body.join('\n'),
    `📸 Photos & full details:\n${url}`,
  ].join('\n\n');
}

// ── External share targets ──────────────────────────────────────
// Deep links that open the target app with the message pre-filled.
// The message already contains the property URL, so WhatsApp/SMS
// take just the text; Telegram wants url+text split.

export interface ShareTargetLinks {
  whatsapp: string;
  telegram: string;
  email: string;
  sms: string;
}

export function buildShareTargets(message: string, url: string, title: string): ShareTargetLinks {
  const text = encodeURIComponent(message);
  return {
    whatsapp: `https://wa.me/?text=${text}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${text}`,
    sms: `sms:?&body=${text}`,
  };
}
