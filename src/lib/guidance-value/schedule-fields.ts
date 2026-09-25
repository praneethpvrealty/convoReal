import {
  SCHEDULE_DOCUMENTS,
  SCHEDULE_KINDS,
  SCHEDULE_USAGES,
  type Boundaries,
  type PropertySchedule,
  type ScheduleDocument,
  type ScheduleFloor,
  type ScheduleKind,
  type ScheduleUsage,
  type ValuationOptions,
} from './types';
import { parseArea } from './units';

export const SCHEDULE_MAX_BYTES = 4 * 1024 * 1024;

const SCHEDULE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function isScheduleMimeType(
  mimeType: string | null | undefined
): boolean {
  return SCHEDULE_MIME_TYPES.includes((mimeType ?? '').toLowerCase());
}

function cleanString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return trimmed || undefined;
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  const text = cleanString(value, 40)?.toLowerCase();
  return text && (allowed as readonly string[]).includes(text)
    ? (text as T)
    : undefined;
}

function cleanFloors(value: unknown): ScheduleFloor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const floors = value
    .map((floor): ScheduleFloor | null => {
      if (!floor || typeof floor !== 'object') return null;
      const input = floor as { label?: unknown; area?: unknown };
      const label = cleanString(input.label, 60);
      const area = parseArea(input.area);
      return label && area ? { label, area } : null;
    })
    .filter((floor): floor is ScheduleFloor => floor !== null)
    .slice(0, 20);
  return floors.length ? floors : undefined;
}

function cleanBoundaries(value: unknown): Boundaries | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const out: Boundaries = {};
  for (const side of ['east', 'west', 'north', 'south'] as const) {
    const text = cleanString(input[side], 200);
    if (text) out[side] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitiseSchedule(raw: unknown): PropertySchedule {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: PropertySchedule = {};

  for (const key of [
    'state',
    'district',
    'taluk',
    'hobli',
    'village',
    'city',
    'locality',
    'road',
    'municipal_number',
    'pid',
    'survey_number',
    'khata_number',
  ] as const) {
    const value = cleanString(input[key]);
    if (value) out[key] = value;
  }

  const villageLocal = cleanString(input.village_local, 80);
  if (villageLocal) out.village_local = villageLocal;
  const extentPrinted = cleanString(input.extent_printed, 40);
  if (extentPrinted) out.extent_printed = extentPrinted;
  const documentType = pickEnum<ScheduleDocument>(
    input.document_type,
    SCHEDULE_DOCUMENTS
  );
  if (documentType) out.document_type = documentType;

  const pincode = cleanString(input.pincode, 12)?.replace(/\D/g, '');
  if (pincode && /^[1-9]\d{5}$/.test(pincode)) out.pincode = pincode;

  const kind = pickEnum<ScheduleKind>(input.kind, SCHEDULE_KINDS);
  if (kind) out.kind = kind;
  const usage = pickEnum<ScheduleUsage>(input.usage, SCHEDULE_USAGES);
  if (usage) out.usage = usage;

  const landArea = parseArea(input.land_area);
  if (landArea) out.land_area = landArea;
  const builtUp = parseArea(input.built_up_area);
  if (builtUp) out.built_up_area = builtUp;

  const floors = cleanFloors(input.floors);
  if (floors) out.floors = floors;
  const boundaries = cleanBoundaries(input.boundaries);
  if (boundaries) out.boundaries = boundaries;

  const summary = cleanString(input.summary, 400);
  if (summary) out.summary = summary;

  return out;
}

export function parseValuationOptions(raw: unknown): ValuationOptions {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: ValuationOptions = {};
  for (const key of [
    'land_area_sqft',
    'built_up_area_sqft',
    'building_rate_per_sqft',
  ] as const) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value > 0 && value < 1e10) out[key] = value;
  }
  return out;
}
