import { AREA_UNITS, type Area, type AreaUnit } from './types';

const SQFT_PER_UNIT: Record<AreaUnit, number> = {
  sqft: 1,
  sqm: 10.763910416709722,
  acre: 43560,
  gunta: 1089,
  hectare: 107639.10416709722,
};

export function toSqft(area: Area): number {
  return area.value * SQFT_PER_UNIT[area.unit];
}

export function ratePerSqft(rate: number, unit: AreaUnit): number {
  return rate / SQFT_PER_UNIT[unit];
}

export function isAreaUnit(value: unknown): value is AreaUnit {
  return (
    typeof value === 'string' &&
    (AREA_UNITS as readonly string[]).includes(value)
  );
}

const UNIT_ALIASES: Array<[RegExp, AreaUnit]> = [
  [
    /^(sq\.?\s*m(tr?s?|eters?|etres?)?\.?|sqm|m2|square\s*m(eters?|etres?))$/,
    'sqm',
  ],
  [/^(sq\.?\s*f(ee)?t\.?|sft|sqft|square\s*f(ee|oo)t|s\.?ft\.?)$/, 'sqft'],
  [/^(acres?|ac\.?)$/, 'acre'],
  [/^(guntas?|gts?\.?)$/, 'gunta'],
  [/^(hectares?|ha\.?)$/, 'hectare'],
];

export function normaliseUnit(raw: unknown): AreaUnit | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (isAreaUnit(text)) return text;
  for (const [pattern, unit] of UNIT_ALIASES) {
    if (pattern.test(text)) return unit;
  }
  return null;
}

export function parseArea(raw: unknown): Area | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as { value?: unknown; unit?: unknown };
  const value = Number(
    typeof input.value === 'string'
      ? input.value.replace(/,/g, '').trim()
      : input.value
  );
  const unit = normaliseUnit(input.unit);
  if (!unit || !Number.isFinite(value) || value <= 0) return null;
  return { value, unit };
}

export function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export const UNIT_LABELS: Record<AreaUnit, string> = {
  sqft: 'sq.ft',
  sqm: 'sq.m',
  acre: 'acre',
  gunta: 'gunta',
  hectare: 'hectare',
};
