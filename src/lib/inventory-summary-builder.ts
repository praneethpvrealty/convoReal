// Builds the WhatsApp "inventory shout-out" digest for the showcase
// share dialog: published listings grouped by category (Residential /
// Commercial / Agricultural), one pipe-separated line per property with
// rent & ROI when available. Pure functions so the exact message a
// receiver sees is unit-testable.

import type { Contact, Property } from '@/types';
import { CATEGORY_SUBTYPES } from '@/lib/search-parser';
import { formatShareAmount } from '@/lib/share-message-builder';
import { rankInventoryProperties } from '@/lib/inventory/top-properties';

export type SummaryCategory =
  | 'Residential'
  | 'Commercial'
  | 'Agricultural'
  | 'Other';

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

function areaSegment(p: Property): string {
  if (p.land_area && p.land_area > 0) {
    return `${p.land_area.toLocaleString('en-IN')} ${p.land_area_unit || 'Sq.Ft.'}`;
  }
  if (p.area_sqft && p.area_sqft > 0) {
    return `${p.area_sqft.toLocaleString('en-IN')} ${p.area_unit || 'Sq.Ft.'}`;
  }
  return '';
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

/** One WhatsApp line: *Title* | Type | Area | Price [| Rental | ROI] [| BHK] | Location */
export function buildSummaryLine(p: Property): string {
  const segments = [
    `*${p.title.trim()}*`,
    TYPE_SHORT_LABELS[p.type] || p.type || '',
    areaSegment(p),
    ...priceSegments(p),
    p.bedrooms && p.bedrooms > 0 ? `${p.bedrooms} BHK` : '',
    locationSegment(p),
  ];
  return segments.filter(Boolean).join(' | ');
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
  {
    portalUrl,
    category = 'All',
    maxPerCategory = 10,
    contact,
    recipientName,
    preserveOrder = false,
  }: InventorySummaryOptions
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
  if (ranking.personalized && ranking.matchCount > 0) {
    const firstMatchIndex = new Map<SummaryCategory, number>();
    ranking.properties.forEach((property, index) => {
      if (!ranking.matchedPropertyIds.has(property.id)) return;
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
    const lines = shown.map((p, i) => `${i + 1}. ${buildSummaryLine(p)}`);
    if (list.length > shown.length) {
      lines.push(
        `_+${list.length - shown.length} more ${cat} listings on the portal_`
      );
    }
    sections.push(`*${cat.toUpperCase()}*\n${lines.join('\n')}`);
  }

  const firstName = recipientName?.trim().split(/\s+/)[0];
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
