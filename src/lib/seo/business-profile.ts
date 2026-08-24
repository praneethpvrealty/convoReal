import type { Property } from '@/types';

export interface PublicBusinessProfile {
  description: string;
  areasServed: string[];
  propertyTypes: string[];
  inventoryLastUpdated: string | null;
}

export interface PublicBusinessProfileOverrides {
  description?: string | null;
  areasServed?: string[] | null;
  propertyTypes?: string[] | null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase('en-IN');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function joinNatural(values: string[]): string {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ');
}

function cleanArea(value: string): string {
  const cleaned = cleanLabel(value);
  if (/^bangalore$/i.test(cleaned)) return 'Bengaluru';
  return cleaned;
}

export function buildPublicBusinessProfile(
  businessName: string,
  properties: Property[],
  overrides: PublicBusinessProfileOverrides = {}
): PublicBusinessProfile {
  const inventoryAreas = unique(
    [
      ...properties.map((property) => property.sublocality),
      ...properties.map((property) => property.city),
    ].map((value) => (value ? cleanArea(value) : value))
  ).slice(0, 12);
  const inventoryPropertyTypes = unique(
    properties.map((property) =>
      property.type ? cleanLabel(property.type) : property.type
    )
  ).slice(0, 12);
  const customAreas = unique(
    (overrides.areasServed ?? []).map(cleanArea)
  ).slice(0, 12);
  const customPropertyTypes = unique(
    (overrides.propertyTypes ?? []).map(cleanLabel)
  ).slice(0, 12);
  const areasServed = customAreas.length > 0 ? customAreas : inventoryAreas;
  const propertyTypes =
    customPropertyTypes.length > 0
      ? customPropertyTypes
      : inventoryPropertyTypes;
  const inventoryLastUpdated =
    properties
      .map((property) => property.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const expertise = propertyTypes.slice(0, 4);
  const areas = areasServed.slice(0, 4);
  const customDescription = overrides.description?.trim();
  const description =
    customDescription ||
    (expertise.length > 0 || areas.length > 0
      ? `${businessName} helps buyers, sellers, investors, and property owners${expertise.length > 0 ? ` with ${joinNatural(expertise)}` : ''}${areas.length > 0 ? ` across ${joinNatural(areas)}` : ''}. Explore current listings or contact our team to discuss your property requirements.`
      : `${businessName} helps clients discover and market real estate opportunities. Explore current listings or contact our team to discuss your property requirements.`);

  return {
    description,
    areasServed,
    propertyTypes,
    inventoryLastUpdated,
  };
}
