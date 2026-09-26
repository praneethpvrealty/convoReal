import type { Property } from '@/types';

export interface DealFloorKind {
  key: string;
  label: string;
  types: string[];
}

export const DEAL_FLOOR_KINDS: DealFloorKind[] = [
  {
    key: 'kind:commercial-land',
    label: 'Commercial land',
    types: ['Commercial Land', 'Commercial Plot'],
  },
  {
    key: 'kind:residential-plots',
    label: 'Residential plots',
    types: ['Residential Land/ Plot', 'Residential Plot', 'Residential Land'],
  },
  {
    key: 'kind:houses',
    label: 'Houses & villas',
    types: ['Residential House', 'Villa', 'Farm House', 'House'],
  },
  {
    key: 'kind:commercial-buildings',
    label: 'Commercial buildings',
    types: ['Commercial Building', 'Commercial Shop', 'Commercial Showroom'],
  },
  {
    key: 'kind:offices',
    label: 'Office space',
    types: ['Commercial Office Space', 'Office in IT Park/ SEZ'],
  },
  {
    key: 'kind:flats',
    label: 'Flats',
    types: [
      'Flat/ Apartment',
      'Builder Floor Apartment',
      'Penthouse',
      'Studio Apartment',
    ],
  },
  {
    key: 'kind:industrial',
    label: 'Industrial',
    types: [
      'Industrial Land',
      'Industrial Building',
      'Industrial Shed',
      'Warehouse/ Godown',
      'Commercial/ Industrial',
      'Commercial/Industrial',
    ],
  },
  {
    key: 'kind:agricultural',
    label: 'Agricultural',
    types: ['Agricultural Land', 'Agricultural'],
  },
  {
    key: 'kind:pg',
    label: 'PG & hostels',
    types: ['Residential PG building', 'PG/ Hostel'],
  },
];

const KIND_BY_KEY = new Map(DEAL_FLOOR_KINDS.map((kind) => [kind.key, kind]));

export function dealFloorKindTypes(key: string): string[] | null {
  return KIND_BY_KEY.get(key)?.types ?? null;
}

export interface DealFloorKindCount extends DealFloorKind {
  count: number;
}

export function dealFloorKindCounts(
  properties: Property[]
): DealFloorKindCount[] {
  const counts = new Map<string, number>();
  const covered = new Set(DEAL_FLOOR_KINDS.flatMap((kind) => kind.types));
  let other = 0;
  for (const property of properties) {
    const kind = DEAL_FLOOR_KINDS.find((candidate) =>
      candidate.types.includes(property.type)
    );
    if (kind) counts.set(kind.key, (counts.get(kind.key) ?? 0) + 1);
    else if (!covered.has(property.type)) other += 1;
  }
  const kinds = DEAL_FLOOR_KINDS.map((kind) => ({
    ...kind,
    count: counts.get(kind.key) ?? 0,
  }))
    .filter((kind) => kind.count > 0)
    .sort((a, b) => b.count - a.count);
  if (other > 0) {
    const otherTypes = [
      ...new Set(
        properties
          .map((property) => property.type)
          .filter((type) => !covered.has(type))
      ),
    ];
    kinds.push({
      key: 'kind:other',
      label: 'Everything else',
      types: otherTypes,
      count: other,
    });
  }
  return kinds;
}

export const DEAL_FLOOR_BUDGETS: Array<{ label: string; max: number }> = [
  { label: 'under ₹1 Cr', max: 10_000_000 },
  { label: 'under ₹3 Cr', max: 30_000_000 },
  { label: 'under ₹8 Cr', max: 80_000_000 },
  { label: 'under ₹25 Cr', max: 250_000_000 },
  { label: 'under ₹50 Cr', max: 500_000_000 },
];

export function withinBudget(property: Property, max: number | null): boolean {
  if (max === null) return true;
  if (property.teaser_gated) return false;
  const listingType = property.listing_type || 'Sale';
  if (listingType === 'Rent' || listingType === 'Built to Suit') {
    const rent = property.rent_per_month ?? 0;
    return rent > 0 && rent <= max;
  }
  if (listingType === 'JV/JD') return false;
  return property.price > 0 && property.price <= max;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function newThisWeek(properties: Property[], now = Date.now()): number {
  return properties.filter((property) => {
    const created = new Date(property.created_at).getTime();
    return Number.isFinite(created) && now - created <= WEEK_MS;
  }).length;
}

export function topLocalities(
  properties: Property[],
  limit = 4
): Array<{ name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const property of properties) {
    const raw = (
      property.sublocality ||
      property.location?.split(',')[0] ||
      property.city ||
      ''
    ).trim();
    if (!raw) continue;
    const key = raw.toLocaleLowerCase();
    const entry = counts.get(key) ?? { name: raw, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function featuredProperty(properties: Property[]): Property | null {
  const candidates = properties.filter(
    (property) =>
      property.status === 'Available' &&
      !property.teaser_gated &&
      (property.images?.length ?? 0) > 0 &&
      (property.listing_type || 'Sale') === 'Sale' &&
      property.price > 0
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, property) =>
    property.price > best.price ? property : best
  );
}

export function quickPickOrder(properties: Property[]): Property[] {
  const playable = properties.filter(
    (property) => property.status === 'Available' && !property.teaser_gated
  );
  const withPhotos = playable.filter(
    (property) => (property.images?.length ?? 0) > 0
  );
  const withoutPhotos = playable.filter(
    (property) => (property.images?.length ?? 0) === 0
  );
  return [...withPhotos, ...withoutPhotos];
}

export const QUICK_PICKS_ROUND = 8;
export const MATCH_REPORT_SHORTLIST = 3;

export function tasteSummary(liked: Property[]): {
  headline: string;
  chips: string[];
} {
  if (liked.length === 0) {
    return { headline: 'Nothing clicked. Try another round?', chips: [] };
  }
  const kindCounts = new Map<string, number>();
  const chips = new Set<string>();
  for (const property of liked) {
    const kind = DEAL_FLOOR_KINDS.find((candidate) =>
      candidate.types.includes(property.type)
    );
    const label = kind?.label ?? property.type;
    kindCounts.set(label, (kindCounts.get(label) ?? 0) + 1);
    chips.add(label);
    const locality = (
      property.sublocality ||
      property.location?.split(',')[0] ||
      ''
    ).trim();
    if (locality) chips.add(locality);
    const band = DEAL_FLOOR_BUDGETS.find((budget) =>
      withinBudget(property, budget.max)
    );
    if (band) chips.add(band.label);
  }
  const [topKind] = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    headline: `You lean towards ${topKind[0].toLocaleLowerCase()}.`,
    chips: [...chips],
  };
}

export interface PlotFaceDetails {
  headline: string;
  caption: string | null;
  road: string | null;
  facing: string | null;
}

export function plotFaceDetails(property: Property): PlotFaceDetails {
  const dimensions = property.dimensions?.trim();
  const area = property.land_area || property.area_sqft;
  const unit = property.land_area
    ? property.land_area_unit || 'Sq.Ft.'
    : property.area_unit || 'Sq.Ft.';
  const areaText = area ? `${area.toLocaleString('en-IN')} ${unit}` : null;
  const facing = property.facing_direction?.trim() || null;
  const road = property.road_width
    ? `${property.road_width} ${property.road_width_unit || 'ft'} road`
    : null;
  const headline = dimensions || areaText || property.land_zone || 'Plot';
  const captionParts = [
    dimensions && areaText ? areaText : null,
    facing ? `${facing} facing` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    headline,
    caption: captionParts.length ? captionParts.join(' · ') : null,
    road,
    facing,
  };
}

export function dealFloorPriceLabel(
  property: Property,
  formatPrice: (amount: number) => string
): string {
  const listingType = property.listing_type || 'Sale';
  if (listingType === 'Rent' || listingType === 'Built to Suit') {
    return `${formatPrice(property.rent_per_month || 0)}/mo`;
  }
  if (listingType === 'JV/JD') {
    return property.owner_share_percent && property.builder_share_percent
      ? `${property.owner_share_percent}:${property.builder_share_percent} share`
      : 'Enquire';
  }
  if (property.teaser_gated) return property.price_band || 'On request';
  return formatPrice(property.price);
}

export function dealFloorLocality(property: Property): string {
  if (property.sublocality && property.city) {
    return `${property.sublocality}, ${property.city}`;
  }
  return (
    property.city ||
    property.sublocality ||
    property.location ||
    'Location shared on inquiry'
  );
}
