import { haversineKm } from '@/lib/geo';

export const PROPERTY_DUPLICATE_RADIUS_METERS = 100;

export interface PropertyDuplicateInput {
  id?: string;
  title?: string | null;
  type?: string | null;
  listing_type?: string | null;
  project?: string | null;
  area_sqft?: number | null;
  land_area?: number | null;
  price?: number | null;
  floor_number?: number | null;
  latitude: number;
  longitude: number;
}

export interface PropertyDuplicateAssessment {
  distanceMeters: number;
  confidence: 'high' | 'possible' | 'nearby';
  score: number;
  signals: string[];
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() || null;
}

function nearlyEqual(left: number | null | undefined, right: number | null | undefined, tolerance: number) {
  if (left == null || right == null || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) / Math.max(left, right) <= tolerance;
}

export function assessPropertyDuplicate(
  listing: PropertyDuplicateInput,
  candidate: PropertyDuplicateInput
): PropertyDuplicateAssessment | null {
  const distanceMeters = Math.round(
    haversineKm(listing.latitude, listing.longitude, candidate.latitude, candidate.longitude) * 1000
  );
  if (distanceMeters > PROPERTY_DUPLICATE_RADIUS_METERS) return null;

  let score = distanceMeters <= 25 ? 45 : distanceMeters <= 50 ? 38 : 30;
  const signals = [`Map pins are ${distanceMeters} m apart`];

  if (normalized(listing.type) === normalized(candidate.type)) {
    score += 15;
    signals.push('Same property type');
  }
  if (normalized(listing.listing_type) === normalized(candidate.listing_type)) {
    score += 10;
    signals.push('Same listing type');
  }
  if (normalized(listing.project) && normalized(listing.project) === normalized(candidate.project)) {
    score += 15;
    signals.push('Same project or building');
  }
  if (
    nearlyEqual(listing.area_sqft, candidate.area_sqft, 0.05) ||
    nearlyEqual(listing.land_area, candidate.land_area, 0.05)
  ) {
    score += 10;
    signals.push('Area is within 5%');
  }
  if (nearlyEqual(listing.price, candidate.price, 0.05)) {
    score += 10;
    signals.push('Price is within 5%');
  }
  if (listing.floor_number != null && listing.floor_number === candidate.floor_number) {
    score += 10;
    signals.push('Same floor');
  }

  score = Math.min(100, score);
  return {
    distanceMeters,
    score,
    confidence: score >= 75 ? 'high' : score >= 50 ? 'possible' : 'nearby',
    signals,
  };
}
