import type { AreaOfInterestGeo } from '@/types';

/**
 * Validate untrusted input into a clean AreaOfInterestGeo list: entries need
 * a non-empty name and finite, in-range coordinates; duplicate names
 * (case-insensitive) keep the first occurrence.
 */
export function sanitizeAreasGeo(value: unknown): AreaOfInterestGeo[] {
  if (!Array.isArray(value)) return [];
  const out: AreaOfInterestGeo[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { name, lat, lng } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) continue;
    const trimmed = name.trim();
    if (out.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) continue;
    out.push({ name: trimmed, lat, lng });
  }
  return out;
}

/**
 * Drop geo entries whose area is no longer in the areas-of-interest list,
 * so removing an area from the text input also removes its coordinates.
 */
export function pruneAreasGeo(geo: AreaOfInterestGeo[], areas: string[]): AreaOfInterestGeo[] {
  const wanted = new Set(areas.map((a) => a.trim().toLowerCase()));
  return geo.filter((g) => wanted.has(g.name.trim().toLowerCase()));
}
