import type { Contact, Property } from '@/types';
import { curateForBuyer, hasBuyerBrief } from '@/lib/buyer/matches-ranking';

export interface RankedInventory {
  properties: Property[];
  matchedPropertyIds: Set<string>;
  matchCount: number;
  personalized: boolean;
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
  };
}
