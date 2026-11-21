import type { Contact, Property } from '@/types';
import { curateForBuyer, hasBuyerBrief } from '@/lib/buyer/matches-ranking';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import { CATEGORY_SUBTYPES } from '@/lib/search-parser';
import { isEnquiryBudgetAnchor } from '@/lib/matching';

export interface RankedInventory {
  properties: Property[];
  matchedPropertyIds: Set<string>;
  matchCount: number;
  personalized: boolean;
  /** Unmatched listings are ordered by how near they sit to the brief. */
  closestFirst: boolean;
  /** Inventory categories the brief names, when it has no match to show. */
  briefCategories: string[];
}

const INVENTORY_CATEGORIES = ['Residential', 'Commercial', 'Agricultural'];

const BRIEF_CATEGORY: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Commercial',
  agricultural: 'Agricultural',
};

function inventoryCategory(type: string | null | undefined): string | null {
  if (!type) return null;
  return (
    INVENTORY_CATEGORIES.find((category) =>
      CATEGORY_SUBTYPES[category]?.includes(type)
    ) ?? null
  );
}

const CATEGORY_MISS_PENALTY = 10;
const MAX_BUDGET_DISTANCE = 5;
const RENT_BUDGET_CEILING = 1_000_000;

/**
 * How far a listing sits from the contact's brief, lower being nearer,
 * or null when the brief states neither a category nor a budget. A
 * contact with no match was shown starred and recently edited stock as
 * the "closest options", which put a ₹380 Cr IT park in front of a buyer
 * who had called ₹21 Cr beyond budget.
 */
function briefCategories(source: Contact): Set<string> {
  const wanted = new Set<string>();
  for (const category of source.pref_property_categories ?? []) {
    const mapped = BRIEF_CATEGORY[String(category).toLowerCase()];
    if (mapped) wanted.add(mapped);
  }
  for (const type of [
    ...(source.property_interests ?? []),
    ...(source.pref_property_types ?? []),
  ]) {
    const mapped = inventoryCategory(type);
    if (mapped) wanted.add(mapped);
  }
  return wanted;
}

function briefDistance(
  contact: Contact
): ((property: Property) => number) | null {
  const source = resolveRequirementSource(contact);
  const wanted = briefCategories(source);

  const max = Number(source.pref_budget_max ?? source.max_budget ?? 0) || null;
  const anchored = isEnquiryBudgetAnchor(max, source.pref_budget_anchor);
  const min = anchored
    ? null
    : Number(source.pref_budget_min ?? source.min_budget ?? 0) || null;
  if (wanted.size === 0 && min === null && max === null) return null;

  return (property) => {
    const category = inventoryCategory(property.type);
    const categoryMiss =
      wanted.size > 0 && (!category || !wanted.has(category))
        ? CATEGORY_MISS_PENALTY
        : 0;
    if (min === null && max === null) return categoryMiss;
    const rental = property.listing_type === 'Rent';
    if (rental !== (max ?? min ?? 0) < RENT_BUDGET_CEILING)
      return categoryMiss + MAX_BUDGET_DISTANCE;
    const price = Number(
      (rental ? property.rent_per_month : property.price) || 0
    );
    if (!(price > 0)) return categoryMiss + 1;
    let distance = 0;
    if (max !== null && price > max) distance = (price - max) / max;
    else if (min !== null && price < min) distance = (min - price) / min;
    return categoryMiss + Math.min(distance, MAX_BUDGET_DISTANCE);
  };
}

function hasRankingIntent(contact: Contact): boolean {
  if (
    contact.requirement_active === false ||
    contact.is_dead ||
    contact.is_archived
  ) {
    return false;
  }
  return Boolean(
    hasBuyerBrief(contact) ||
    contact.last_inquired_property_id ||
    contact.inquired_listing_types?.length ||
    contact.pref_listing_types?.length ||
    contact.pref_land_area_min_sqft ||
    contact.pref_land_area_max_sqft
  );
}

function readinessScore(property: Property): number {
  let score = 0;
  if (
    Number(property.price || 0) > 0 ||
    Number(property.rent_per_month || 0) > 0
  ) {
    score += 5;
  }
  if (
    Number(property.land_area || 0) > 0 ||
    Number(property.area_sqft || 0) > 0
  ) {
    score += 4;
  }
  if (property.sublocality?.trim() || property.location?.trim()) score += 4;
  if (property.images?.some((image) => image?.trim()) || property.video_url)
    score += 4;
  if (
    property.description?.trim() ||
    property.features?.length ||
    property.nearby_highlights?.length
  ) {
    score += 2;
  }
  if (property.property_code?.trim()) score += 1;
  if (
    property.google_map_link ||
    (Number.isFinite(Number(property.latitude)) &&
      Number.isFinite(Number(property.longitude)))
  ) {
    score += 1;
  }
  if (Number(property.roi || 0) > 0 || Number(property.rental_income || 0) > 0)
    score += 1;
  return score;
}

function updatedAt(property: Property): number {
  const value = Date.parse(property.updated_at || property.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

export function rankInventoryProperties(
  properties: Property[],
  contact?: Contact | null,
  { preserveOrder = false }: { preserveOrder?: boolean } = {}
): RankedInventory {
  const originalOrder = new Map(
    properties.map((property, index) => [property.id, index])
  );
  const matches = contact ? curateForBuyer(properties, contact) : [];
  const matchScores = new Map(
    matches.map((match) => [match.property.id, match.score])
  );
  if (
    contact?.last_inquired_property_id &&
    contact.requirement_active !== false &&
    !contact.is_dead &&
    !contact.is_archived &&
    (matchScores.has(contact.last_inquired_property_id) ||
      !hasBuyerBrief(contact)) &&
    properties.some(
      (property) => property.id === contact.last_inquired_property_id
    )
  ) {
    matchScores.set(contact.last_inquired_property_id, 100);
  }
  const matchedPropertyIds = new Set(matchScores.keys());
  const personalized = Boolean(contact && hasRankingIntent(contact));
  const distance =
    personalized && contact && !preserveOrder ? briefDistance(contact) : null;
  const distances = new Map(
    distance ? properties.map((p) => [p.id, distance(p)]) : []
  );

  const ranked = preserveOrder
    ? [...properties]
    : [...properties].sort((a, b) => {
        if (personalized) {
          const aScore = matchScores.get(a.id);
          const bScore = matchScores.get(b.id);
          const aMatched = aScore !== undefined;
          const bMatched = bScore !== undefined;
          if (aMatched !== bMatched) return bMatched ? 1 : -1;
          if (aMatched && bMatched && aScore !== bScore) return bScore - aScore;
          if (!aMatched && !bMatched) {
            const gap = (distances.get(a.id) ?? 0) - (distances.get(b.id) ?? 0);
            if (gap !== 0) return gap;
          }
        }

        if (Boolean(a.is_starred) !== Boolean(b.is_starred)) {
          return b.is_starred ? 1 : -1;
        }

        const readiness = readinessScore(b) - readinessScore(a);
        if (readiness !== 0) return readiness;

        const recency = updatedAt(b) - updatedAt(a);
        if (recency !== 0) return recency;

        return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
      });

  return {
    properties: ranked,
    matchedPropertyIds,
    matchCount: matchedPropertyIds.size,
    personalized,
    closestFirst: distance !== null,
    briefCategories:
      distance && contact && matchedPropertyIds.size === 0
        ? [...briefCategories(resolveRequirementSource(contact))]
        : [],
  };
}
