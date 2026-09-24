export const E_KHATA_MAX_BYTES = 10 * 1024 * 1024;

const E_KHATA_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function isEKhataMimeType(mimeType: string | null | undefined): boolean {
  return E_KHATA_MIME_TYPES.includes((mimeType ?? '').toLowerCase());
}

const E_KHATA_NAME = /e[\s._-]*kh?at+h?a|\bkh?at+h?a\b|\bepid\b/i;

export function looksLikeEKhata(name: string | null | undefined): boolean {
  return E_KHATA_NAME.test(name ?? '');
}

export interface EKhataFloor {
  floor: string | null;
  area_sqft: number | null;
  occupancy: string | null;
  year_built: number | null;
}

export interface EKhataBoundaries {
  north?: string;
  east?: string;
  west?: string;
  south?: string;
}

export interface EKhataFields {
  epid?: string;
  khata_form?: 'A' | 'B';
  document_number?: string;
  document_date?: string;
  corporation?: string;
  ward?: string;
  property_number?: string;
  address?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  site_frontage_ft?: number;
  site_depth_ft?: number;
  site_area_sqft?: number;
  ownership_type?: string;
  floors?: EKhataFloor[];
  built_up_sqft?: number;
  year_built?: number;
  owners?: string[];
  boundaries?: EKhataBoundaries;
  tax_year?: string;
  tax_paid?: number;
  liabilities?: string;
}

function text(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  return trimmed || undefined;
}

function positive(value: unknown, max = 1e8): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[^\d.]/g, ''))
        : NaN;
  return Number.isFinite(n) && n > 0 && n < max ? n : undefined;
}

function coordinate(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function inIndia(latitude: number, longitude: number): boolean {
  return latitude >= 6 && latitude <= 37 && longitude >= 68 && longitude <= 98;
}

function year(value: unknown, now = new Date()): number | undefined {
  const n = Math.round(Number(value));
  return Number.isInteger(n) && n >= 1800 && n <= now.getFullYear() + 1
    ? n
    : undefined;
}

function withoutIdNumbers(value: string): string {
  return value.replace(/[X*\d][X*\d\s-]{5,}\d/gi, '').trim();
}

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function sanitiseEKhata(raw: unknown, now = new Date()): EKhataFields {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: EKhataFields = {};

  const epid = text(input.epid, 40)?.replace(/\s/g, '');
  if (epid && /^\d{6,20}$/.test(epid)) out.epid = epid;

  const form = text(input.khata_form, 20)
    ?.toUpperCase()
    .replace(/FORM|[\s-]/g, '');
  if (form === 'A' || form === 'B') out.khata_form = form;

  for (const key of [
    'document_number',
    'corporation',
    'ward',
    'property_number',
    'ownership_type',
    'tax_year',
    'liabilities',
  ] as const) {
    const value = text(input[key], 120);
    if (value) out[key] = value;
  }

  const date = text(input.document_date, 20);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.document_date = date;

  const address = text(input.address, 300);
  if (address) out.address = address;

  const pincode =
    text(input.pincode, 12)?.replace(/\D/g, '') ??
    address?.match(/\b([1-9]\d{5})\b(?!.*\b[1-9]\d{5}\b)/)?.[1];
  if (pincode && /^[1-9]\d{5}$/.test(pincode)) out.pincode = pincode;

  let latitude = coordinate(input.latitude);
  let longitude = coordinate(input.longitude);
  if (latitude !== undefined && longitude !== undefined) {
    if (!inIndia(latitude, longitude) && inIndia(longitude, latitude)) {
      [latitude, longitude] = [longitude, latitude];
    }
    if (inIndia(latitude, longitude)) {
      out.latitude = latitude;
      out.longitude = longitude;
    }
  }

  const dims = input.site_dimensions_ft as Record<string, unknown> | undefined;
  const frontage = positive(dims?.east_west, 1e5);
  const depth = positive(dims?.north_south, 1e5);
  if (frontage && depth) {
    out.site_frontage_ft = round(frontage);
    out.site_depth_ft = round(depth);
  }

  const siteArea = positive(input.site_area_sqft);
  if (siteArea) out.site_area_sqft = round(siteArea);

  const floors = Array.isArray(input.floors)
    ? input.floors
        .filter(
          (f): f is Record<string, unknown> => !!f && typeof f === 'object'
        )
        .slice(0, 30)
        .map((f) => ({
          floor: text(f.floor, 40) ?? null,
          area_sqft: positive(f.area_sqft) ?? null,
          occupancy: text(f.occupancy, 40) ?? null,
          year_built: year(f.year_built, now) ?? null,
        }))
        .filter((f) => f.area_sqft !== null || f.year_built !== null)
    : [];
  if (floors.length) {
    out.floors = floors;
    const builtUp = floors.reduce((sum, f) => sum + (f.area_sqft ?? 0), 0);
    if (builtUp > 0) out.built_up_sqft = round(builtUp);
  }

  const years = floors
    .map((f) => f.year_built)
    .filter((y): y is number => y !== null);
  const built = years.length ? Math.min(...years) : year(input.year_built, now);
  if (built) out.year_built = built;

  if (Array.isArray(input.owners)) {
    const owners = input.owners
      .map((o) => text(o, 120))
      .filter((o): o is string => Boolean(o))
      .map(withoutIdNumbers)
      .filter(Boolean)
      .slice(0, 10);
    if (owners.length) out.owners = owners;
  }

  const b = input.boundaries as Record<string, unknown> | undefined;
  if (b && typeof b === 'object') {
    const boundaries: EKhataBoundaries = {};
    for (const side of ['north', 'east', 'west', 'south'] as const) {
      const value = text(b[side], 120);
      if (value) boundaries[side] = value;
    }
    if (Object.keys(boundaries).length) out.boundaries = boundaries;
  }

  const tax = positive(input.tax_paid, 1e10);
  if (tax) out.tax_paid = round(tax);

  return out;
}

export function isReadableEKhata(fields: EKhataFields): boolean {
  return Boolean(
    fields.epid ||
    (fields.address && (fields.site_area_sqft || fields.khata_form))
  );
}

export function eKhataCity(fields: EKhataFields): string | undefined {
  return /bangalore|bengaluru|bbmp|bruhat/i.test(
    `${fields.corporation ?? ''} ${fields.address ?? ''}`
  )
    ? 'Bengaluru'
    : undefined;
}

export type EKhataChangeKey =
  | 'address'
  | 'city'
  | 'pin'
  | 'land_area'
  | 'dimensions'
  | 'built_up_area'
  | 'year_built'
  | 'khata_epid'
  | 'khata_form';

export interface EKhataCurrent {
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  land_area?: string | number | null;
  dimensions?: string | null;
  built_up_area?: string | number | null;
  year_built?: string | number | null;
  khata_epid?: string | null;
  khata_form?: string | null;
}

export interface EKhataChange {
  key: EKhataChangeKey;
  label: string;
  value: string;
  current: string;
  replaces: boolean;
}

function shown(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function same(a: string, b: string): boolean {
  const numA = Number(a.replace(/,/g, ''));
  const numB = Number(b.replace(/,/g, ''));
  if (a && b && Number.isFinite(numA) && Number.isFinite(numB)) {
    return Math.abs(numA - numB) < 0.5;
  }
  return (
    a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()
  );
}

export function eKhataDimensions(fields: EKhataFields): string | undefined {
  return fields.site_frontage_ft && fields.site_depth_ft
    ? `${fields.site_frontage_ft}x${fields.site_depth_ft}`
    : undefined;
}

export function eKhataChanges(
  fields: EKhataFields,
  current: EKhataCurrent,
  opts: { isApartment?: boolean; isLand?: boolean } = {}
): EKhataChange[] {
  const proposals: Array<
    [EKhataChangeKey, string, string | undefined, string]
  > = [
    ['address', 'Address', fields.address, shown(current.address)],
    ['city', 'City', eKhataCity(fields), shown(current.city)],
    [
      'pin',
      'Map pin',
      fields.latitude !== undefined && fields.longitude !== undefined
        ? `${fields.latitude.toFixed(6)}, ${fields.longitude.toFixed(6)}`
        : undefined,
      current.latitude != null && current.longitude != null
        ? `${Number(current.latitude).toFixed(6)}, ${Number(current.longitude).toFixed(6)}`
        : '',
    ],
    [
      'land_area',
      'Site area (sq ft)',
      opts.isApartment ? undefined : fields.site_area_sqft?.toString(),
      shown(current.land_area),
    ],
    [
      'dimensions',
      'Dimensions (ft)',
      opts.isApartment ? undefined : eKhataDimensions(fields),
      shown(current.dimensions),
    ],
    [
      'built_up_area',
      'Built-up area (sq ft)',
      opts.isLand ? undefined : fields.built_up_sqft?.toString(),
      shown(current.built_up_area),
    ],
    [
      'year_built',
      'Year built',
      fields.year_built?.toString(),
      shown(current.year_built),
    ],
    ['khata_epid', 'ePID', fields.epid, shown(current.khata_epid)],
    [
      'khata_form',
      'Khata',
      fields.khata_form ? `Form-${fields.khata_form}` : undefined,
      current.khata_form ? `Form-${current.khata_form}` : '',
    ],
  ];

  return proposals
    .filter((p): p is [EKhataChangeKey, string, string, string] =>
      Boolean(p[2])
    )
    .filter(([, , value, now]) => !now || !same(value, now))
    .map(([key, label, value, now]) => ({
      key,
      label,
      value,
      current: now,
      replaces: Boolean(now),
    }));
}

export function eKhataNotes(fields: EKhataFields): string[] {
  const notes: string[] = [];
  if (fields.owners?.length) notes.push(`Owner: ${fields.owners.join(', ')}`);
  if (fields.ownership_type) notes.push(`Type: ${fields.ownership_type}`);
  if (fields.floors?.length) {
    notes.push(
      `Floors: ${fields.floors
        .map((f) =>
          [f.floor, f.area_sqft ? `${f.area_sqft} sq ft` : null, f.occupancy]
            .filter(Boolean)
            .join(' · ')
        )
        .join('; ')}`
    );
  }
  if (fields.tax_year || fields.tax_paid) {
    notes.push(
      `Property tax: ${[
        fields.tax_year,
        fields.tax_paid ? `₹${fields.tax_paid.toLocaleString('en-IN')}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}`
    );
  }
  if (fields.liabilities) notes.push(`Liabilities: ${fields.liabilities}`);
  const b = fields.boundaries;
  if (b) {
    notes.push(
      `Boundaries: ${(['north', 'east', 'west', 'south'] as const)
        .filter((side) => b[side])
        .map((side) => `${side[0].toUpperCase()}: ${b[side]}`)
        .join(' · ')}`
    );
  }
  if (fields.document_number || fields.corporation) {
    notes.push(
      `Document: ${[fields.document_number, fields.corporation].filter(Boolean).join(' · ')}`
    );
  }
  return notes;
}

export function khataColumns(input: {
  khata_epid?: unknown;
  khata_form?: unknown;
  year_built?: unknown;
}): {
  khata_epid?: string | null;
  khata_form?: 'A' | 'B' | null;
  year_built?: number | null;
} {
  const out: {
    khata_epid?: string | null;
    khata_form?: 'A' | 'B' | null;
    year_built?: number | null;
  } = {};
  if (input.khata_epid !== undefined) {
    const epid =
      typeof input.khata_epid === 'string'
        ? input.khata_epid.replace(/\s/g, '')
        : '';
    out.khata_epid = epid && epid.length <= 40 ? epid : null;
  }
  if (input.khata_form !== undefined) {
    const form =
      typeof input.khata_form === 'string'
        ? input.khata_form.trim().toUpperCase()
        : '';
    out.khata_form = form === 'A' || form === 'B' ? form : null;
  }
  if (input.year_built !== undefined) {
    out.year_built = year(input.year_built) ?? null;
  }
  return out;
}
