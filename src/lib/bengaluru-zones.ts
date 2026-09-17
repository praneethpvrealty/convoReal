export const BENGALURU_ZONES = {
  'CBD & Off-CBD': [
    'Ashok Nagar',
    'Benson Town',
    'Brigade Road',
    'Chamarajpet',
    'Church Street',
    'Cooke Town',
    'Cox Town',
    'Cunningham Road',
    'Frazer Town',
    'Gandhi Nagar',
    'Lavelle Road',
    'Majestic',
    'MG Road',
    'Richmond Town',
    'Seshadripuram',
    'Shanthala Nagar',
    'Shivajinagar',
    'Ulsoor',
    'Vasanth Nagar',
  ],
  SBD: [
    'Domlur',
    'Ejipura',
    'HAL',
    'Indiranagar',
    'Jayanagar',
    'Koramangala',
    'Old Airport Road',
    'Ulsoor',
  ],
  ORR: [
    'Bellandur',
    'Doddanekundi',
    'HSR Layout',
    'Kadubeesanahalli',
    'Mahadevapura',
    'Marathahalli',
    'Outer Ring Road',
    'Panathur',
  ],
  'PBD East': [
    'Brookefield',
    'Hoodi',
    'ITPL',
    'Kadugodi',
    'Kundalahalli',
    'Varthur',
    'Whitefield',
  ],
  'PBD South': [
    'Anekal',
    'Attibele',
    'Bommasandra',
    'Chandapura',
    'Electronic City',
    'Hosa Road',
    'Hosur Road',
    'Jigani',
    'Singasandra',
  ],
  'PBD North': [
    'Airport Road',
    'Bagalur',
    'Devanahalli',
    'Hebbal',
    'Jakkur',
    'Kempegowda International Airport',
    'Nagawara',
    'Thanisandra',
    'Yelahanka',
  ],
  'North Bengaluru': [
    'Airport Road',
    'Bagalur',
    'Devanahalli',
    'Hebbal',
    'Jakkur',
    'Kempegowda International Airport',
    'Nagawara',
    'RT Nagar',
    'Sadashivanagar',
    'Sahakara Nagar',
    'Thanisandra',
    'Vidyaranyapura',
    'Yelahanka',
  ],
  'North-East Bengaluru': [
    'Banaswadi',
    'HBR Layout',
    'Hennur',
    'Horamavu',
    'Kalyan Nagar',
    'Kammanahalli',
    'Nagawara',
    'Ramamurthy Nagar',
    'Thanisandra',
  ],
  'East Bengaluru': [
    'Brookefield',
    'CV Raman Nagar',
    'Doddanekundi',
    'Domlur',
    'Gunjur',
    'HAL',
    'Hoodi',
    'Indiranagar',
    'ITPL',
    'Kadugodi',
    'Kaggadasapura',
    'KR Puram',
    'Kundalahalli',
    'Mahadevapura',
    'Marathahalli',
    'Old Airport Road',
    'Panathur',
    'Varthur',
    'Whitefield',
  ],
  'South-East Bengaluru': [
    'Anekal',
    'Attibele',
    'Bellandur',
    'Bommanahalli',
    'Bommasandra',
    'Carmelaram',
    'Chandapura',
    'Electronic City',
    'Haralur',
    'Hosa Road',
    'Hosur Road',
    'HSR Layout',
    'Jigani',
    'Kadubeesanahalli',
    'Kaikondrahalli',
    'Kasavanahalli',
    'Koramangala',
    'Kudlu',
    'Sarjapur',
    'Sarjapur Road',
    'Singasandra',
  ],
  'South Bengaluru': [
    'Anjanapura',
    'Arekere',
    'Banashankari',
    'Bannerghatta Road',
    'Basavanagudi',
    'Begur',
    'Bilekahalli',
    'BTM Layout',
    'Girinagar',
    'Gottigere',
    'Hulimavu',
    'Jayanagar',
    'JP Nagar',
    'Kanakapura Road',
    'Kumaraswamy Layout',
    'Padmanabhanagar',
    'Subramanyapura',
    'Talaghattapura',
    'Uttarahalli',
    'Wilson Garden',
    'Yelachenahalli',
  ],
  'South-West Bengaluru': [
    'Banashankari',
    'Chandra Layout',
    'Kengeri',
    'Mysore Road',
    'Nagarbhavi',
    'Nayandahalli',
    'Rajarajeshwari Nagar',
    'RR Nagar',
    'Uttarahalli',
  ],
  'West Bengaluru': [
    'Basaveshwaranagar',
    'Chandra Layout',
    'Kengeri',
    'Magadi Road',
    'Malleshwaram',
    'Mysore Road',
    'Nagarbhavi',
    'Nayandahalli',
    'Peenya',
    'Rajajinagar',
    'Rajarajeshwari Nagar',
    'Vijayanagar',
    'Yeshwanthpur',
  ],
  'North-West Bengaluru': [
    'Dasarahalli',
    'Jalahalli',
    'Nagasandra',
    'Peenya',
    'Tumkur Road',
    'Yeshwanthpur',
  ],
} as const;

export type BengaluruZone = keyof typeof BENGALURU_ZONES;

const ZONE_ALIASES: Record<string, BengaluruZone> = {
  central: 'CBD & Off-CBD',
  cbd: 'CBD & Off-CBD',
  offcbd: 'CBD & Off-CBD',
  cbdoffcbd: 'CBD & Off-CBD',
  sbd: 'SBD',
  orr: 'ORR',
  outerringroad: 'ORR',
  pbdeast: 'PBD East',
  pbdsouth: 'PBD South',
  pbdnorth: 'PBD North',
  north: 'North Bengaluru',
  northeast: 'North-East Bengaluru',
  east: 'East Bengaluru',
  southeast: 'South-East Bengaluru',
  south: 'South Bengaluru',
  southwest: 'South-West Bengaluru',
  west: 'West Bengaluru',
  northwest: 'North-West Bengaluru',
};

function zoneKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/bengaluru|bangalore|zone/g, '')
    .replace(/[^a-z]/g, '');
}

export function canonicalBengaluruZone(value: string): BengaluruZone | null {
  return ZONE_ALIASES[zoneKey(value)] ?? null;
}

export function bengaluruZoneLocalities(value: string): readonly string[] {
  const zone = canonicalBengaluruZone(value);
  if (!zone) return [];

  if (zone === 'South Bengaluru') {
    return [
      ...BENGALURU_ZONES[zone],
      ...BENGALURU_ZONES['South-East Bengaluru'],
      ...BENGALURU_ZONES['South-West Bengaluru'],
    ];
  }
  if (zone === 'North Bengaluru') {
    return [
      ...BENGALURU_ZONES[zone],
      ...BENGALURU_ZONES['North-East Bengaluru'],
      ...BENGALURU_ZONES['North-West Bengaluru'],
    ];
  }
  return BENGALURU_ZONES[zone];
}

export function extractBengaluruZones(text: string): BengaluruZone[] {
  const matches = text.matchAll(
    /\b(?:(north(?:[\s-]?(?:east|west))?|south(?:[\s-]?(?:east|west))?|east|west|central)\s+(?:bangalore|bengaluru)(?:\s+zone)?|cbd(?:\s*(?:&|and)\s*off[\s-]?cbd)?|off[\s-]?cbd|sbd|orr|outer ring road|pbd[\s-]?(?:east|south|north))\b/gi
  );
  const zones = [...matches]
    .filter((match) => {
      const preceding = text.slice(
        Math.max(0, (match.index ?? 0) - 24),
        match.index
      );
      return !/\b(?:not|except|excluding|exclude|avoid|no)\s*$/i.test(
        preceding
      );
    })
    .map((match) => canonicalBengaluruZone(match[0]))
    .filter((zone): zone is BengaluruZone => zone !== null);
  return [...new Set(zones)];
}
