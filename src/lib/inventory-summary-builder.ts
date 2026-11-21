// Builds the WhatsApp "inventory shout-out" digest for the showcase
// share dialog: published listings grouped by category (Residential /
// Commercial / Agricultural), one pipe-separated line per property with
// rent & ROI when available. Pure functions so the exact message a
// receiver sees is unit-testable.

import type { Contact, Property } from '@/types';
import { CATEGORY_SUBTYPES } from '@/lib/search-parser';
import { formatShareAmount } from '@/lib/share-message-builder';
import { rankInventoryProperties } from '@/lib/inventory/top-properties';
import { greetingName } from '@/lib/contacts/greeting-name';

export const INVENTORY_SUMMARY_PROPERTY_COLUMNS =
  'id, title, type, listing_type, price, price_per_sqft, rent_per_month, rental_income, roi, area_sqft, area_unit, land_area, land_area_unit, bedrooms, location, sublocality, city, project, property_code, listing_source, latitude, longitude, tags, is_starred, images, video_url, description, features, nearby_highlights, google_map_link, showcase_audience, facing_direction, tower, floor_number, floor_tenancies, notes, locality_canonical, created_at, updated_at';

export type SummaryCategory =
  'Residential' | 'Commercial' | 'Agricultural' | 'Other';

const CATEGORY_ORDER: SummaryCategory[] = [
  'Residential',
  'Commercial',
  'Agricultural',
  'Other',
];

// Raw property types are verbose ("Residential Land/ Plot") — WhatsApp
// lines read better with the short labels agents actually use.
const TYPE_SHORT_LABELS: Record<string, string> = {
  'Residential Land/ Plot': 'Plot',
  'Flat/ Apartment': 'Apartment',
  'Builder Floor Apartment': 'Builder Floor',
  'Residential House': 'House',
  'Studio Apartment': 'Studio',
  'Commercial Office Space': 'Office',
  'Office in IT Park/ SEZ': 'Office (IT Park)',
  'Commercial Shop': 'Shop',
  'Commercial Showroom': 'Showroom',
  'Commercial Building': 'Commercial Bldg',
  'Commercial Plot': 'Commercial Plot',
  'Commercial Land': 'Commercial Land',
  'Warehouse/ Godown': 'Warehouse',
  'Agricultural Land': 'Agri Land',
};

export function categoryForType(
  type: string | null | undefined
): SummaryCategory {
  if (type) {
    // "Farm House" is listed under both Residential and Agricultural —
    // CATEGORY_ORDER makes Residential win, matching the showcase filter.
    for (const cat of CATEGORY_ORDER) {
      if (CATEGORY_SUBTYPES[cat]?.includes(type)) return cat;
    }
  }
  return 'Other';
}

function formatArea(value: number, unit: string | null | undefined): string {
  return `${value.toLocaleString('en-IN')} ${unit || 'Sq.Ft.'}`;
}

function isLandType(type: string | null | undefined): boolean {
  return /Land|Plot/.test(type || '');
}

function areaSegments(p: Property): string[] {
  const land =
    p.land_area && p.land_area > 0
      ? formatArea(p.land_area, p.land_area_unit)
      : '';
  const builtUp =
    p.area_sqft && p.area_sqft > 0 ? formatArea(p.area_sqft, p.area_unit) : '';
  if (isLandType(p.type)) return [land || builtUp].filter(Boolean);
  if (land && builtUp) return [`Plot ${land}`, `Built-up ${builtUp}`];
  if (land) return [`Plot ${land}`];
  return builtUp ? [builtUp] : [];
}

export function bedroomSegment(p: Property): string {
  if (!p.bedrooms || p.bedrooms <= 0) return '';
  if (categoryForType(p.type) === 'Commercial') return '';
  return p.bedrooms > 5 ? `${p.bedrooms} bedrooms` : `${p.bedrooms} BHK`;
}

function priceSegments(p: Property): string[] {
  const segments: string[] = [];
  if (p.listing_type === 'Rent') {
    const rent = formatShareAmount(p.rent_per_month);
    if (rent) segments.push(`${rent}/mo rent`);
  } else {
    const price = formatShareAmount(p.price);
    if (price) segments.push(price);
    // Investment listings: monthly rental income + ROI when captured.
    const rental = formatShareAmount(p.rental_income);
    if (rental) segments.push(`Rental ${rental}/mo`);
    if (p.roi && p.roi > 0) segments.push(`ROI ${p.roi}%`);
  }
  return segments;
}

function locationSegment(p: Property): string {
  return p.sublocality?.trim() || p.city?.trim() || '';
}

/** One WhatsApp line: *Title* | Type | Area | Price [| Rental | ROI] [| Bedrooms] | Location */
export function buildSummaryLine(p: Property): string {
  const segments = [
    `*${p.title.trim()}*`,
    TYPE_SHORT_LABELS[p.type] || p.type || '',
    ...areaSegments(p),
    ...priceSegments(p),
    bedroomSegment(p),
    locationSegment(p),
  ];
  return segments.filter(Boolean).join(' | ');
}

const PROPERTY_LINK_PARAMS = ['ref', 'mode', 's', 'v'];

export const WHATSAPP_TEXT_BUDGET = 4000;

export function summaryPropertyUrl(
  portalUrl: string,
  property: Pick<Property, 'id' | 'property_code'>
): string {
  if (!portalUrl) return '';
  try {
    const source = new URL(portalUrl);
    const url = new URL(source.origin + source.pathname);
    url.searchParams.set('property_id', property.property_code || property.id);
    for (const key of PROPERTY_LINK_PARAMS) {
      const value = source.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return '';
  }
}

export interface InventorySummaryOptions {
  /** Portal link included in the header (audience-appropriate). */
  portalUrl: string;
  /** Restrict to one showcase category; 'All' keeps every section. */
  category?: 'All' | 'Residential' | 'Commercial' | 'Agricultural';
  /** Listings per section before the "+N more" trailer (default 10). */
  maxPerCategory?: number;
  /** Contact whose current brief should put the strongest matches first. */
  contact?: Contact | null;
  /** Name used only for the greeting; internal name tags never reach it. */
  recipientName?: string | null;
  /** Keep an agent's explicit hand-picked sequence unchanged. */
  preserveOrder?: boolean;
}

export function buildInventorySummary(
  properties: Property[],
  options: InventorySummaryOptions
): string {
  const requested = Math.max(1, options.maxPerCategory ?? 10);
  let summary = composeInventorySummary(properties, options, requested);
  for (
    let limit = requested - 1;
    limit >= 1 && summary.length > WHATSAPP_TEXT_BUDGET;
    limit--
  ) {
    summary = composeInventorySummary(properties, options, limit);
  }
  return summary;
}

function composeInventorySummary(
  properties: Property[],
  {
    portalUrl,
    category = 'All',
    contact,
    recipientName,
    preserveOrder = false,
  }: InventorySummaryOptions,
  maxPerCategory: number
): string {
  const ranking = rankInventoryProperties(properties, contact, {
    preserveOrder,
  });
  const grouped = new Map<SummaryCategory, Property[]>();
  for (const p of ranking.properties) {
    const cat = categoryForType(p.type);
    if (category !== 'All' && cat !== category) continue;
    const list = grouped.get(cat) || [];
    list.push(p);
    grouped.set(cat, list);
  }

  const categoryOrder = [...CATEGORY_ORDER];
  const byMatch = ranking.personalized && ranking.matchCount > 0;
  if (byMatch || ranking.closestFirst) {
    const firstMatchIndex = new Map<SummaryCategory, number>();
    ranking.properties.forEach((property, index) => {
      if (byMatch && !ranking.matchedPropertyIds.has(property.id)) return;
      const cat = categoryForType(property.type);
      if (!firstMatchIndex.has(cat)) firstMatchIndex.set(cat, index);
    });
    categoryOrder.sort((a, b) => {
      const aIndex = firstMatchIndex.get(a);
      const bIndex = firstMatchIndex.get(b);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
      return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
    });
  }

  const sections: string[] = [];
  for (const cat of categoryOrder) {
    const list = grouped.get(cat);
    if (!list?.length) continue;
    const shown = list.slice(0, maxPerCategory);
    const lines = shown.map((p, i) => {
      const line = `${i + 1}. ${buildSummaryLine(p)}`;
      const link = summaryPropertyUrl(portalUrl, p);
      return link ? `${line}\n🔗 ${link}` : line;
    });
    if (list.length > shown.length) {
      lines.push(
        `_+${list.length - shown.length} more ${cat} listings on the portal_`
      );
    }
    sections.push(`*${cat.toUpperCase()}*\n${lines.join('\n')}`);
  }

  const firstName = greetingName(recipientName);
  const greeting = firstName ? `Hi ${firstName}!` : 'Hi there!';
  if (sections.length === 0) {
    return contact
      ? `*INVENTORY UPDATE* 🏠\n\n${greeting} There are no published options in this selection that I should resend to you right now. I will share fresh matches as soon as they become available.`
      : '';
  }

  const intro = ranking.personalized
    ? ranking.matchCount > 0
      ? `${greeting} Here are our live listings. I have put the ${ranking.matchCount} strongest match${ranking.matchCount === 1 ? '' : 'es'} for your saved requirement first.`
      : `${greeting} I could not find a close match to your saved requirement yet, so here are the current available options.`
    : `${greeting} Here's a quick summary of the properties currently available with us:`;

  return [
    '*INVENTORY UPDATE* 🏠',
    intro,
    sections.join('\n\n'),
    `Full details, photos & inquiries:\n${portalUrl}`,
    'For individual photos and complete details, reply with the category and numbers — for example: commercial 3,9.',
    'Reply here for site visits, documents, or the best price on any of these.',
  ].join('\n\n');
}
