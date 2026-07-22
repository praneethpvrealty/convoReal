// ============================================================
// Portal Post Kit — prepares copy-ready content for manually
// posting a property on the Indian listing portals (99acres,
// MagicBricks, Housing). None of them expose a public posting
// API, so the kit's job is to make the manual form a 3-minute
// copy-paste: fields in the portal's own order and vocabulary,
// clamped to its length limits, with a deep link to the post
// form. Pure functions — no network, fully unit-testable.
// ============================================================

import type { Property } from '@/types';
import { formatShareAmount } from '@/lib/share-message-builder';

export type PortalKey = '99acres' | 'magicbricks' | 'housing';

export interface PortalMeta {
  key: PortalKey;
  label: string;
  /** Deep link to the portal's "post property" entry point. */
  postUrl: string;
  /** Portal form limits — titles/descriptions get clamped to these. */
  maxTitle: number;
  maxDescription: number;
  /** Badge styling on inventory cards / dialog tabs. */
  chip: string;
  shortCode: string;
}

export const PORTALS: Record<PortalKey, PortalMeta> = {
  '99acres': {
    key: '99acres',
    label: '99acres',
    postUrl: 'https://www.99acres.com/postproperty/',
    maxTitle: 70,
    maxDescription: 5000,
    chip: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    shortCode: '99',
  },
  magicbricks: {
    key: 'magicbricks',
    label: 'MagicBricks',
    postUrl: 'https://post.magicbricks.com/',
    maxTitle: 100,
    maxDescription: 3000,
    chip: 'bg-red-500/10 border-red-500/30 text-red-400',
    shortCode: 'MB',
  },
  housing: {
    key: 'housing',
    label: 'Housing.com',
    postUrl: 'https://housing.com/sell',
    maxTitle: 100,
    maxDescription: 5000,
    chip: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
    shortCode: 'H',
  },
};

export const PORTAL_KEYS = Object.keys(PORTALS) as PortalKey[];

export interface PortalField {
  label: string;
  value: string;
}

export function clampText(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isLand(property: Property): boolean {
  return (property.type || '').includes('Land') || (property.type || '').includes('Plot');
}

function areaValue(property: Property): string {
  const land = isLand(property);
  const val = land ? property.land_area : property.area_sqft;
  const unit = land ? property.land_area_unit || 'sqft' : property.area_unit || 'sqft';
  return val ? `${val} ${unit}` : '';
}

/** "100x150", "100 x 150 ft", "40X60" → plot length/width. */
export function parseDimensions(dimensions?: string | null): { length: string; width: string } | null {
  if (!dimensions) return null;
  const m = dimensions.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet)?\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { length: m[1], width: m[2] };
}

function roadWidthFeet(property: Property): string {
  if (!property.road_width) return '';
  const unit = (property.road_width_unit || 'ft').toLowerCase();
  const metres = unit === 'm' || unit.startsWith('met');
  return String(metres ? Math.round(property.road_width * 3.281) : property.road_width);
}

/** Housing.com marks these mandatory on its post form but the CRM
 *  doesn't model them all — send review-and-fix defaults so autofill
 *  completes the step (1-yr age, resale, immediate possession), plus
 *  plot extras derived from dimensions/road width where the CRM has
 *  real data. The agent reviews everything on the portal before
 *  submitting. */
function housingExtras(property: Property, currency: string): PortalField[] {
  const land = isLand(property);
  const unit = (land ? property.land_area_unit : property.area_unit) || 'sqft';
  const dims = parseDimensions(property.dimensions);
  // Default brokerage: 1% of price on sale, one month's rent on rent.
  const rental = property.listing_type === 'Rent' || property.listing_type === 'Built to Suit';
  const brokerage = rental ? property.rent_per_month || 0 : Math.round((property.price || 0) * 0.01);
  return [
    { label: 'Transaction Type', value: 'Resale' },
    { label: 'Possession Status', value: 'Immediate' },
    { label: 'Age of Property', value: '1' },
    { label: 'Area Unit', value: unit },
    ...(brokerage > 0
      ? [
          { label: 'Charge Brokerage', value: 'Yes' },
          { label: 'Brokerage', value: formatShareAmount(brokerage, currency) },
        ]
      : []),
    ...(land && dims
      ? [
          { label: 'Length', value: dims.length },
          { label: 'Width', value: dims.width },
        ]
      : []),
    ...(land && property.road_width ? [{ label: 'Width of Facing Road', value: roadWidthFeet(property) }] : []),
    ...(land
      ? [
          { label: 'Boundary Wall', value: 'Yes' },
          { label: 'Open Sides', value: '1' },
        ]
      : []),
  ];
}

function priceValue(property: Property, currency: string): string {
  if (property.listing_type === 'Rent' || property.listing_type === 'Built to Suit') {
    return formatShareAmount(property.rent_per_month, currency);
  }
  return formatShareAmount(property.price, currency);
}

/** Plain-text description for portal forms: no WhatsApp asterisks,
 *  no emojis, and no external URLs (portals reject/strip links). */
export function buildPortalDescription(property: Property, portal: PortalKey): string {
  const paragraphs: string[] = [];

  if (property.description?.trim()) {
    paragraphs.push(property.description.trim());
  }

  const specs = [
    property.bedrooms ? `${property.bedrooms} BHK` : '',
    property.bathrooms ? `${property.bathrooms} bathrooms` : '',
    areaValue(property),
    property.super_built_area ? `${property.super_built_area} super built-up` : '',
    property.dimensions ? `Dimensions ${property.dimensions}` : '',
    property.facing_direction ? `${property.facing_direction} facing` : '',
    property.road_width ? `${property.road_width} ${property.road_width_unit || 'ft'} road` : '',
  ].filter(Boolean);
  if (specs.length > 0) paragraphs.push(specs.join('. ') + '.');

  const features = (property.features || []).filter(Boolean);
  if (features.length > 0) paragraphs.push(`Highlights: ${features.join(', ')}.`);

  const highlights = (property.nearby_highlights || []).filter(Boolean);
  if (highlights.length > 0) paragraphs.push(`Nearby: ${highlights.join(', ')}.`);

  if (property.rental_income) {
    paragraphs.push(
      `Current rental income of ${formatShareAmount(property.rental_income)} per month${property.roi ? ` (approx. ${property.roi}% ROI)` : ''}.`
    );
  }

  const text = paragraphs.join('\n\n').replace(/https?:\/\/\S+/g, '').replace(/[ \t]+\n/g, '\n').trim();
  return clampText(text, PORTALS[portal].maxDescription);
}

/** Fields in roughly the order each portal's post form asks for them,
 *  so the agent copies top-to-bottom without hunting. */
export function buildPortalFields(property: Property, portal: PortalKey, currency: string = 'INR'): PortalField[] {
  const meta = PORTALS[portal];
  const listingFor =
    property.listing_type === 'Rent' || property.listing_type === 'Built to Suit' ? 'Rent / Lease' : 'Sale';

  const fields: PortalField[] = [
    { label: 'Listing For', value: listingFor },
    { label: 'Property Type', value: property.type || '' },
    { label: 'City', value: property.city || '' },
    { label: 'Locality', value: property.sublocality || property.location || '' },
    { label: 'Title', value: clampText(property.title || '', meta.maxTitle) },
    ...(property.project ? [{ label: 'Project / Society', value: property.project }] : []),
    ...(property.bedrooms ? [{ label: 'Bedrooms', value: String(property.bedrooms) }] : []),
    ...(property.bathrooms ? [{ label: 'Bathrooms', value: String(property.bathrooms) }] : []),
    { label: isLand(property) ? 'Plot Area' : 'Built-up Area', value: areaValue(property) },
    ...(property.facing_direction ? [{ label: 'Facing', value: property.facing_direction }] : []),
    {
      label: property.listing_type === 'Rent' || property.listing_type === 'Built to Suit' ? 'Monthly Rent' : 'Expected Price',
      value: priceValue(property, currency),
    },
    ...(property.listing_type === 'Rent' && property.maintenance
      ? [{ label: 'Maintenance', value: formatShareAmount(property.maintenance, currency) }]
      : []),
    ...(property.listing_type === 'Rent' && property.advance
      ? [{ label: 'Security Deposit / Advance', value: formatShareAmount(property.advance, currency) }]
      : []),
    ...(portal === 'housing' ? housingExtras(property, currency) : []),
    { label: 'Description', value: buildPortalDescription(property, portal) },
  ];

  return fields.filter((f) => f.value.trim().length > 0);
}

const COMMERCIAL_TYPE_RE = /commercial|office|shop|showroom|industrial|warehouse|godown/i;

/** Fields every portal marks mandatory on its post form. A listing
 *  missing any of these can't be posted, so the dialog blocks the
 *  handoff and points the agent back to ConvoReal to fill them first —
 *  making the portals' required fields effectively required here too. */
export function missingRequiredFields(property: Property): string[] {
  const rental = property.listing_type === 'Rent' || property.listing_type === 'Built to Suit';
  const land = isLand(property);
  const commercial = COMMERCIAL_TYPE_RE.test(property.type || '');
  const missing: string[] = [];
  const need = (ok: unknown, label: string) => {
    if (!ok) missing.push(label);
  };

  need(property.type?.trim(), 'Property Type');
  need(property.city?.trim(), 'City');
  need((property.sublocality || property.location || '').trim(), 'Locality');
  need(property.title?.trim(), 'Title');
  need(land ? property.land_area : property.area_sqft, land ? 'Plot Area' : 'Built-up Area');
  need(rental ? property.rent_per_month : property.price, rental ? 'Monthly Rent' : 'Expected Price');
  need(property.description?.trim(), 'Description');
  if (!land && !commercial) need(property.bedrooms, 'Bedrooms');

  return missing;
}

/** How soon before expiry the WhatsApp nudge fires. */
export const PORTAL_EXPIRY_REMINDER_DAYS = 3;
