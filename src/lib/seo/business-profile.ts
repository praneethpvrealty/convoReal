import type { Property } from '@/types';

export interface PublicBusinessProfile {
  description: string;
  areasServed: string[];
  propertyTypes: string[];
  inventoryLastUpdated: string | null;
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

export function buildPublicBusinessProfile(
  businessName: string,
  properties: Property[]
): PublicBusinessProfile {
  const areasServed = unique(
    properties.flatMap((property) => [property.sublocality, property.city])
  ).slice(0, 12);
  const propertyTypes = unique(
    properties.map((property) => property.type)
  ).slice(0, 12);
  const inventoryLastUpdated =
    properties
      .map((property) => property.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const expertise = propertyTypes.slice(0, 4);
  const areas = areasServed.slice(0, 4);
  const description =
    expertise.length > 0 || areas.length > 0
      ? `${businessName} is a real estate consultancy${areas.length > 0 ? ` serving ${joinNatural(areas)}` : ''}${expertise.length > 0 ? `, with current listings for ${joinNatural(expertise)}` : ''}. Browse published property information and contact the consultancy directly.`
      : `${businessName} is a real estate consultancy using ConvoReal to publish property information and respond to buyer enquiries.`;

  return {
    description,
    areasServed,
    propertyTypes,
    inventoryLastUpdated,
  };
}
