// Builds the WhatsApp "inventory shout-out" digest for the showcase
// share dialog: published listings grouped by category (Residential /
// Commercial / Agricultural), one pipe-separated line per property with
// rent & ROI when available. Pure functions so the exact message a
// receiver sees is unit-testable.

import type { Property } from '@/types';
import { CATEGORY_SUBTYPES } from '@/lib/search-parser';
import { formatShareAmount } from '@/lib/share-message-builder';

export type SummaryCategory = 'Residential' | 'Commercial' | 'Agricultural' | 'Other';

const CATEGORY_ORDER: SummaryCategory[] = ['Residential', 'Commercial', 'Agricultural', 'Other'];

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

export function categoryForType(type: string | null | undefined): SummaryCategory {
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
}

export function buildInventorySummary(
  properties: Property[],
  { portalUrl, category = 'All', maxPerCategory = 10 }: InventorySummaryOptions,
): string {
  const grouped = new Map<SummaryCategory, Property[]>();
  for (const p of properties) {
    const cat = categoryForType(p.type);
    if (category !== 'All' && cat !== category) continue;
    const list = grouped.get(cat) || [];
    list.push(p);
    grouped.set(cat, list);
  }

  const sections: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const list = grouped.get(cat);
    if (!list?.length) continue;
    const shown = list.slice(0, maxPerCategory);
    const lines = shown.map((p, i) => `${i + 1}. ${buildSummaryLine(p)}`);
    if (list.length > shown.length) {
      lines.push(`_+${list.length - shown.length} more ${cat} listings on the portal_`);
    }
    sections.push(`*${cat.toUpperCase()}*\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return [
    '*INVENTORY UPDATE* 🏠',
    "Hi there! Here's a quick summary of the properties currently available with us:",
    sections.join('\n\n'),
    `Full details, photos & inquiries:\n${portalUrl}`,
    'Reply here for site visits, documents, or the best price on any of these.',
  ].join('\n\n');
}
