import { CATEGORY_SUBTYPES } from '@/lib/search-parser';
import type { Property } from '@/types';

export interface FarmlandDestination {
  slug: string;
  name: string;
  region: string;
  headline: string;
  subtitle: string;
  metaDescription: string;
  highlights: string[];
  theme: 'violet' | 'emerald' | 'cobalt' | 'amber' | 'rose';
  searchTerms: string[];
}

export const FARMLAND_DESTINATIONS: FarmlandDestination[] = [
  {
    slug: 'coorg',
    name: 'Coorg',
    region: 'Kodagu, Karnataka',
    headline: 'Farm Lands in',
    subtitle:
      'Coffee and spice estates, riverside acreage, and homestay-ready farm land across Madikeri, Virajpet, Somwarpet, and Kushalnagar — verified listings managed directly by owners and agents.',
    metaDescription:
      'Buy farm land and coffee estates in Coorg (Kodagu). Verified agricultural land and farm houses in Madikeri, Virajpet, Somwarpet & Kushalnagar with owner-direct pricing.',
    highlights: [
      'Coffee & spice estates',
      'Madikeri · Virajpet · Kushalnagar',
      'Homestay & weekend-home potential',
    ],
    theme: 'emerald',
    searchTerms: [
      'coorg',
      'kodagu',
      'madikeri',
      'virajpet',
      'somwarpet',
      'kushalnagar',
      'gonikoppal',
      'siddapura',
    ],
  },
  {
    slug: 'chikmagalur',
    name: 'Chikmagalur',
    region: 'Chikkamagaluru, Karnataka',
    headline: 'Farm Lands in',
    subtitle:
      "Estates and agricultural land in Karnataka's coffee country — Mudigere, Kadur, Koppa, and Sringeri belts with plantation, arecanut, and homestay opportunities.",
    metaDescription:
      'Buy farm land and coffee estates in Chikmagalur (Chikkamagaluru). Verified agricultural land and farm houses across Mudigere, Kadur, Koppa & Sringeri.',
    highlights: [
      "Karnataka's coffee country",
      'Mudigere · Kadur · Koppa',
      'Plantation & homestay investments',
    ],
    theme: 'amber',
    searchTerms: [
      'chikmagalur',
      'chikkamagaluru',
      'chickmagalur',
      'mudigere',
      'kadur',
      'koppa',
      'sringeri',
      'balehonnur',
    ],
  },
  {
    slug: 'sakleshpur',
    name: 'Sakleshpur',
    region: 'Hassan, Karnataka',
    headline: 'Farm Lands in',
    subtitle:
      'Malnad greenery about four hours from Bengaluru — coffee, pepper, and cardamom estates in the Hethur and Hanbal belts of the Western Ghats.',
    metaDescription:
      'Buy farm land and estates in Sakleshpur, Hassan. Verified coffee, pepper & cardamom estates and agricultural land in the Western Ghats, close to Bengaluru.',
    highlights: [
      'Western Ghats, ~4 hrs from Bengaluru',
      'Hethur · Hanbal estate belts',
      'Coffee, pepper & cardamom',
    ],
    theme: 'cobalt',
    searchTerms: [
      'sakleshpur',
      'sakleshpura',
      'sakaleshpur',
      'hethur',
      'hanbal',
      'aigoor',
    ],
  },
  {
    slug: 'ooty',
    name: 'Ooty',
    region: 'The Nilgiris, Tamil Nadu',
    headline: 'Farm Lands in',
    subtitle:
      "Tea estates, cottage plots, and agricultural land across the Nilgiris — Udhagamandalam, Coonoor, and Kotagiri — India's most sought-after hill-station address.",
    metaDescription:
      'Buy farm land and tea estates in Ooty (Udhagamandalam), the Nilgiris. Verified agricultural land, estates & farm houses in Coonoor and Kotagiri.',
    highlights: [
      "The Nilgiris' premier hill station",
      'Ooty · Coonoor · Kotagiri',
      'Tea estates & cottage plots',
    ],
    theme: 'rose',
    searchTerms: [
      'ooty',
      'udhagamandalam',
      'ootacamund',
      'nilgiri',
      'nilgiris',
      'coonoor',
      'kotagiri',
    ],
  },
];

export function getFarmlandDestination(
  slug: string
): FarmlandDestination | null {
  const normalized = slug.trim().toLowerCase();
  return FARMLAND_DESTINATIONS.find((d) => d.slug === normalized) || null;
}

export function matchesFarmlandDestination(
  property: Property,
  destination: FarmlandDestination
): boolean {
  if (!CATEGORY_SUBTYPES.Agricultural.includes(property.type)) return false;
  const haystack = [
    property.location,
    property.sublocality,
    property.city,
    property.state,
    property.locality_canonical,
    property.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return destination.searchTerms.some((term) => haystack.includes(term));
}
