import { haversineKm } from '@/lib/geo';
import { rowMatchesLocality } from '@/lib/locality-match';

export const SHOWCASE_NEARBY_RADIUS_KM = 10;

export interface NearbyCandidate {
  id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  city?: string | null;
  locality_canonical?: string | null;
  sublocality?: string | null;
  location?: string | null;
  project?: string | null;
  title?: string | null;
}

export interface NearbyMatch {
  id: string;
  tier: 'exact' | 'nearby';
  distance_km: number | null;
}

export interface NearbyCentre {
  latitude: number;
  longitude: number;
}

export function publicDistanceKm(km: number): number {
  return Math.max(0.5, Math.round(km * 2) / 2);
}

export function dominantCity(
  rows: Array<{ city?: string | null }>
): string | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const label = row.city?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const entry = counts.get(key) ?? { label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { label: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.label ?? null;
}

export function inventoryCentre(rows: NearbyCandidate[]): NearbyCentre | null {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (const row of rows) {
    const lat = row.latitude === null ? NaN : Number(row.latitude);
    const lng = row.longitude === null ? NaN : Number(row.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      lats.push(lat);
      lngs.push(lng);
    }
  }
  if (lats.length === 0) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { latitude: median(lats), longitude: median(lngs) };
}

export function geocodeQuery(query: string, city: string | null): string {
  const trimmed = query.trim();
  if (!city || trimmed.toLocaleLowerCase().includes(city.toLocaleLowerCase())) {
    return trimmed;
  }
  return `${trimmed}, ${city}`;
}

export function rankNearbyListings(
  rows: NearbyCandidate[],
  centre: NearbyCentre | null,
  labels: string[],
  radiusKm = SHOWCASE_NEARBY_RADIUS_KM
): NearbyMatch[] {
  const names = labels
    .map((label) => label.trim())
    .filter((label) => label.length >= 3);

  const matches = rows.flatMap((row): NearbyMatch[] => {
    const lat = row.latitude === null ? NaN : Number(row.latitude);
    const lng = row.longitude === null ? NaN : Number(row.longitude);
    const km =
      centre && Number.isFinite(lat) && Number.isFinite(lng)
        ? haversineKm(centre.latitude, centre.longitude, lat, lng)
        : null;
    const exact = names.some((name) => rowMatchesLocality(row, name));
    if (!exact && (km === null || km > radiusKm)) return [];
    return [
      {
        id: row.id,
        tier: exact ? 'exact' : 'nearby',
        distance_km: km === null ? null : publicDistanceKm(km),
      },
    ];
  });

  return matches.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'exact' ? -1 : 1;
    return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
  });
}
