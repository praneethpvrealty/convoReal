// Option lists mirrored from the web property form
// (src/components/inventory/property-form.tsx) so the mobile editor
// offers the same choices.

export const PROPERTY_TYPE_GROUPS: { group: string; options: string[] }[] = [
  {
    group: 'Residential',
    options: [
      'Flat/ Apartment',
      'Residential House',
      'Villa',
      'Builder Floor Apartment',
      'Residential Land/ Plot',
      'Penthouse',
      'Studio Apartment',
      'Residential PG building',
      'PG/ Hostel',
    ],
  },
  {
    group: 'Commercial',
    options: [
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
    ],
  },
  { group: 'Agricultural', options: ['Agricultural Land', 'Farm House'] },
];

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
