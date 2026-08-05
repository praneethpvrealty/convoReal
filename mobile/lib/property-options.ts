// Option lists mirrored from the web property form
// (src/components/inventory/property-form.tsx) so the mobile editor
// offers the same choices.

// Same list as the web form's hasCommercialFields — gates the
// commercial-only fields (rent roll).
export const COMMERCIAL_TYPES = [
  'Commercial Office Space',
  'Office in IT Park/ SEZ',
  'Commercial Shop',
  'Commercial Showroom',
  'Commercial Building',
  'Commercial Land',
  'Warehouse/ Godown',
  'Industrial Land',
  'Industrial Building',
  'Industrial Shed',
];

export const PROPERTY_TYPE_GROUPS: { group: string; options: string[] }[] = [
  {
    group: 'Residential',
    options: [
      'Flat/ Apartment',
      'Residential House',
      'Villa',
      'Builder Floor Apartment',
      'Residential Plot',
      'Residential Land',
      'Penthouse',
      'Studio Apartment',
      'Residential PG building',
      'PG/ Hostel',
    ],
  },
  {
    group: 'Commercial',
    options: [...COMMERCIAL_TYPES],
  },
  { group: 'Agricultural', options: ['Agricultural Land', 'Farm House'] },
];

// Mirrors of the web predicates in
// src/lib/inventory/property-options.ts — @/lib/mobile-parity.test.ts
// fails when they drift.

/** Pre-split value for residential land; still valid, no longer offered. */
export const LEGACY_RESIDENTIAL_LAND_PLOT = 'Residential Land/ Plot';

export const BEDS_BATHS_TYPES = [
  'Flat/ Apartment',
  'Residential House',
  'Villa',
  'Builder Floor Apartment',
  'Penthouse',
  'Studio Apartment',
  'Farm House',
];

export const LAND_TYPES = [
  'Residential Plot',
  'Residential Land',
  LEGACY_RESIDENTIAL_LAND_PLOT,
  'Commercial Land',
  'Industrial Land',
  'Agricultural Land',
];

export const RAW_LAND_TYPES = [
  'Residential Land',
  LEGACY_RESIDENTIAL_LAND_PLOT,
  'Commercial Land',
  'Industrial Land',
  'Agricultural Land',
];

export const LAND_OWNERSHIP_TYPES = [
  'Single owner',
  'Family owned',
  'Multiple owners (multi-family)',
  'Aggregator / consolidated',
  'Trust',
  'Company',
  'Government / institutional',
];

export const LAND_LEGAL_STATUSES = [
  'Clear title',
  'Under verification',
  'Litigation / dispute',
  'Encumbered / mortgaged',
  'Inherited — partition pending',
  'Power of Attorney held',
];

export const LAND_CONVERSION_TYPES = [
  'Converted (DC converted)',
  'Unconverted / agricultural',
  'Conversion applied',
  'Conversion not required',
  'Part converted',
];

export const LAND_USE_ZONES = [
  'Residential',
  'Commercial',
  'Industrial',
  'Agricultural',
  'Mixed Use',
  'SEZ',
];

export function hasBedsBaths(type: string): boolean {
  return BEDS_BATHS_TYPES.includes(type);
}

export function isLandType(type: string): boolean {
  return LAND_TYPES.includes(type);
}

export function isRawLandType(type: string): boolean {
  return RAW_LAND_TYPES.includes(type);
}

/** Adds the pre-split value to the picker only for a property already
 *  stored as it, so opening an old listing never re-types it. */
export function propertyTypeGroupsFor(
  currentType: string | null | undefined
): { group: string; options: string[] }[] {
  if (currentType !== LEGACY_RESIDENTIAL_LAND_PLOT) return PROPERTY_TYPE_GROUPS;
  return PROPERTY_TYPE_GROUPS.map((g) =>
    g.group === 'Residential'
      ? { ...g, options: [...g.options, LEGACY_RESIDENTIAL_LAND_PLOT] }
      : g
  );
}

export const LISTING_TYPES: { value: string; label: string }[] = [
  { value: 'Sale', label: 'For Sale' },
  { value: 'Rent', label: 'For Rent' },
  { value: 'JV/JD', label: 'JV / JD' },
  { value: 'Built to Suit', label: 'Built to Suit' },
];

export const FACING_DIRECTIONS = [
  'East',
  'North',
  'South',
  'West',
  'North-East',
  'North-West',
  'South-East',
  'South-West',
];

export const AREA_UNITS = ['Sq.Ft.', 'Sq.Mtr.', 'Acre', 'Gunta', 'Cent', 'Ground'];

export const NEARBY_HIGHLIGHTS_OPTIONS = [
  'Metro Station',
  'School',
  'Hospital',
  'Mall',
  'Supermarket',
  'Park',
  'Highway',
  'Airport',
  'Railway Station',
  'Bus Stop',
  'Bank / ATM',
];

export const AMENITIES_BY_CATEGORY: { category: string; items: string[] }[] = [
  {
    category: 'Security & Utilities',
    items: [
      '24/7 Security',
      'CCTV Surveillance',
      'Power Backup',
      'Intercom',
      'Fire Fighting System',
      'Water Supply (Corporation)',
      'Water Supply (Borewell)',
      'Rain Water Harvesting',
      'Waste Disposal',
    ],
  },
  {
    category: 'Leisure & Community',
    items: [
      'Lift/Elevator',
      'Swimming Pool',
      'Gymnasium',
      'Club House',
      "Children's Play Area",
      'Reserved Parking',
      'Visitor Parking',
      'Gated Community',
    ],
  },
  {
    category: 'Commercial & Agricultural Specs',
    items: [
      'Centrally Air Conditioned',
      'Service/Goods Lift',
      'Conference Room',
      'Cafeteria/Food Court',
      'Wi-Fi Connectivity',
      'ATM',
      'Fenced Boundary',
      'Electricity Connection',
      'Access Road',
    ],
  },
];
