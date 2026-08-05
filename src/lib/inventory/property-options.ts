/**
 * Option catalog for the property editor — the choice lists the form
 * renders and the type-classification predicates that decide which
 * field groups are shown.
 *
 * These used to live at the top of `property-form.tsx`, which meant
 * importing a single list pulled in a 5.7k-line client component, and
 * the property-type enum was spelled out twice in that file (once for
 * the predicates, once as literal `<option>` tags). The mobile editor
 * mirrors these lists in `mobile/lib/property-options.ts`;
 * `@/lib/mobile-parity.test.ts` fails when the two drift.
 *
 * The canonical type enum used by the AI parsers and the matching
 * engine is `PROPERTY_TYPE_VALUES` in `@/lib/property-types` — it also
 * carries the "Others" catch-all, which is a normalisation fallback
 * rather than something the form offers.
 */

export const AMENITIES_BY_CATEGORY = {
  'Security & Utilities': [
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
  'Leisure & Community': [
    'Lift/Elevator',
    'Swimming Pool',
    'Gymnasium',
    'Club House',
    "Children's Play Area",
    'Reserved Parking',
    'Visitor Parking',
    'Gated Community',
  ],
  'Commercial & Agricultural Specs': [
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
};

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

export const FURNISHING_OPTIONS = [
  'Furnished',
  'Semi-Furnished',
  'Unfurnished',
];

export const AREA_UNITS = [
  'Sq.Ft.',
  'Sq.Mtr.',
  'Acre',
  'Gunta',
  'Cent',
  'Ground',
];

/** Frontage/depth are always in feet, so land-area linking must convert
 *  through the selected unit. */
export const SQFT_PER_AREA_UNIT: Record<string, number> = {
  'Sq.Ft.': 1,
  'Sq.Mtr.': 10.7639,
  Acre: 43560,
  Gunta: 1089,
  Cent: 435.6,
  Ground: 2400,
};

/**
 * Pre-split value for residential land. 21 rows carried it when the type
 * was split into plot vs land, and nothing in those rows says which one
 * they are — so they keep this value, every land predicate still accepts
 * it, and the picker offers it only to a property already stored as it.
 * Re-classifying is a judgement call for whoever knows the deal.
 */
export const LEGACY_RESIDENTIAL_LAND_PLOT = 'Residential Land/ Plot';

/** Ownership shapes that decide who has to sign the sale deed — the
 *  first question on any raw-land deal. */
export const LAND_OWNERSHIP_TYPES = [
  'Single owner',
  'Family owned',
  'Multiple owners (multi-family)',
  'Aggregator / consolidated',
  'Trust',
  'Company',
  'Government / institutional',
];

/** Where the title stands today. */
export const LAND_LEGAL_STATUSES = [
  'Clear title',
  'Under verification',
  'Litigation / dispute',
  'Encumbered / mortgaged',
  'Inherited — partition pending',
  'Power of Attorney held',
];

/** Whether the parcel may legally be built on, and under what order. */
export const LAND_CONVERSION_TYPES = [
  'Converted (DC converted)',
  'Unconverted / agricultural',
  'Conversion applied',
  'Conversion not required',
  'Part converted',
];

export interface PropertyTypeOption {
  value: string;
  /** Only set when the picker should read differently from the stored
   *  value — e.g. "Commercial Building" shows as "(Mixed-Use)". */
  label?: string;
}

export interface PropertyTypeGroup {
  /** `optgroup` heading on web; section header in the mobile picker. */
  group: string;
  options: PropertyTypeOption[];
}

export const PROPERTY_TYPE_GROUPS: PropertyTypeGroup[] = [
  {
    group: 'Residential',
    options: [
      { value: 'Flat/ Apartment' },
      { value: 'Residential House' },
      { value: 'Villa' },
      { value: 'Builder Floor Apartment' },
      { value: 'Residential Plot', label: 'Residential Plot (in a layout)' },
      { value: 'Residential Land', label: 'Residential Land (raw parcel)' },
      { value: 'Penthouse' },
      { value: 'Studio Apartment' },
      { value: 'Residential PG building' },
      { value: 'PG/ Hostel' },
    ],
  },
  {
    group: 'Commercial',
    options: [
      { value: 'Commercial Office Space' },
      { value: 'Office in IT Park/ SEZ' },
      { value: 'Commercial Shop' },
      { value: 'Commercial Showroom' },
      {
        value: 'Commercial Building',
        label: 'Commercial Building (Mixed-Use)',
      },
      { value: 'Commercial Land' },
      { value: 'Warehouse/ Godown' },
      { value: 'Industrial Land' },
      { value: 'Industrial Building' },
      { value: 'Industrial Shed' },
    ],
  },
  {
    group: 'Agricultural',
    options: [{ value: 'Agricultural Land' }, { value: 'Farm House' }],
  },
];

export const LISTING_TYPES: { value: string; label: string }[] = [
  { value: 'Sale', label: 'For Sale' },
  { value: 'Rent', label: 'For Rent' },
  { value: 'JV/JD', label: 'JV / JD' },
  { value: 'Built to Suit', label: 'Built to Suit' },
];

export const PROPERTY_STATUSES = [
  'Available',
  'Under Contract',
  'Sold',
  'Archived',
  'Off Market',
  'Pending Review',
  'Rejected',
];

const BEDS_BATHS_TYPES = [
  'Flat/ Apartment',
  'Residential House',
  'Villa',
  'Builder Floor Apartment',
  'Penthouse',
  'Studio Apartment',
  'Farm House',
];

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

const LAND_TYPES = [
  'Residential Plot',
  'Residential Land',
  LEGACY_RESIDENTIAL_LAND_PLOT,
  'Commercial Land',
  'Industrial Land',
  'Agricultural Land',
];

/** Raw parcels — sold on title, extent and what may legally be built on
 *  them. A plot in an approved layout has already cleared conversion and
 *  is demarcated, so it does not carry the same paperwork. */
const RAW_LAND_TYPES = [
  'Residential Land',
  LEGACY_RESIDENTIAL_LAND_PLOT,
  'Commercial Land',
  'Industrial Land',
  'Agricultural Land',
];

const APARTMENT_TYPES = [
  'Flat/ Apartment',
  'Builder Floor Apartment',
  'Studio Apartment',
];

export function hasBedsBaths(type: string): boolean {
  return BEDS_BATHS_TYPES.includes(type);
}

/** Gates the commercial-only field groups (rent roll, floor tenancies). */
export function hasCommercialFields(type: string): boolean {
  return COMMERCIAL_TYPES.includes(type);
}

export function isLandType(type: string): boolean {
  return LAND_TYPES.includes(type);
}

/** Gates the title/extent field group (ownership, land use, legal
 *  status, conversion) shown for raw parcels but not layout plots. */
export function isRawLandType(type: string): boolean {
  return RAW_LAND_TYPES.includes(type);
}

/** The picker's residential options, with the pre-split value appended
 *  only for a property still stored as it — so opening an old listing
 *  never silently re-types it, and new listings are never offered the
 *  ambiguous choice. */
export function propertyTypeGroupsFor(currentType: string | null | undefined): PropertyTypeGroup[] {
  if (currentType !== LEGACY_RESIDENTIAL_LAND_PLOT) return PROPERTY_TYPE_GROUPS;
  return PROPERTY_TYPE_GROUPS.map((group) =>
    group.group === 'Residential'
      ? {
          ...group,
          options: [
            ...group.options,
            { value: LEGACY_RESIDENTIAL_LAND_PLOT, label: 'Residential Land/ Plot (legacy)' },
          ],
        }
      : group
  );
}

export function isApartmentType(type: string): boolean {
  return APARTMENT_TYPES.includes(type);
}
