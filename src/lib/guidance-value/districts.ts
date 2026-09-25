const DISTRICTS: Array<[string, string[]]> = [
  ['Bengaluru Rural', ['bengaluru rural', 'bangalore rural']],
  ['Ramanagara', ['ramanagara', 'ramanagaram', 'bengaluru south']],
  [
    'Bengaluru Urban',
    [
      'bengaluru urban',
      'bangalore urban',
      'bbmp',
      'gandhinagar',
      'gandhinagara',
      'jayanagar',
      'jayanagara',
      'rajajinagar',
      'rajajinagara',
      'shivajinagar',
      'shivajinagara',
      'basavanagudi',
      'basavangudi',
      'malleshwaram',
      'malleswaram',
      'shanthinagar',
      'shantinagar',
      'bengaluru',
      'bangalore',
    ],
  ],
  ['Bagalkote', ['bagalkote', 'bagalkot']],
  ['Ballari', ['ballari', 'bellary']],
  ['Belagavi', ['belagavi', 'belgaum']],
  ['Bidar', ['bidar']],
  ['Chamarajanagar', ['chamarajanagar', 'chamarajanagara']],
  ['Chikkaballapur', ['chikkaballapur', 'chikkaballapura']],
  ['Chikkamagaluru', ['chikkamagaluru', 'chikkamagalur', 'chikmagalur']],
  ['Chitradurga', ['chitradurga']],
  ['Dakshina Kannada', ['dakshina kannada', 'mangaluru', 'mangalore']],
  ['Davanagere', ['davanagere', 'davangere']],
  ['Dharwad', ['dharwad', 'hubballi', 'hubli']],
  ['Gadag', ['gadag']],
  ['Hassan', ['hassan']],
  ['Haveri', ['haveri']],
  ['Kalaburagi', ['kalaburagi', 'gulbarga']],
  ['Kodagu', ['kodagu', 'coorg']],
  ['Kolar', ['kolar']],
  ['Koppal', ['koppal']],
  ['Mandya', ['mandya']],
  ['Mysuru', ['mysuru', 'mysore']],
  ['Raichur', ['raichur']],
  ['Shivamogga', ['shivamogga', 'shimoga']],
  ['Tumakuru', ['tumakuru', 'tumkur']],
  ['Udupi', ['udupi']],
  ['Uttara Kannada', ['uttara kannada', 'karwar']],
  ['Vijayanagara', ['vijayanagara', 'hosapete', 'hospet']],
  ['Vijayapura', ['vijayapura', 'bijapur']],
  ['Yadgir', ['yadgir', 'yadagiri']],
];

export function districtFromLabel(label: string): string | null {
  const text = ` ${label.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  for (const [district, names] of DISTRICTS) {
    if (names.some((name) => text.includes(` ${name} `))) return district;
  }
  return null;
}

function districtKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(district|dist|zilla|taluk|taluka)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXACT_DISTRICTS = new Map<string, string>(
  DISTRICTS.flatMap(([district, names]) => [
    [districtKey(district), district],
    ...names.map((name): [string, string] => [name, district]),
  ])
);

export function exactDistrict(value: string | null | undefined): string | null {
  return EXACT_DISTRICTS.get(districtKey(value ?? '')) ?? null;
}

export function sourceDistrict(label: string): string {
  return districtFromLabel(label) ?? label.trim();
}

export function rateDistrict(
  printed: string | null | undefined,
  source: string | null | undefined
): string | null {
  return (
    exactDistrict(printed) ??
    districtFromLabel(source ?? '') ??
    (source?.trim() || printed?.trim() || null)
  );
}
