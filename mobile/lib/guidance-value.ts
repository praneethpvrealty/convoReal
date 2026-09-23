import type {
  AreaUnit,
  GuidanceRate,
  LookupResult,
  PropertySchedule,
  SavedGuidanceValue,
  ScheduleKind,
  ScheduleUsage,
} from '@shared/lib/guidance-value/types';

import { ApiError, apiFetch } from './api';

export type {
  AreaUnit,
  LookupResult,
  PropertySchedule,
  RateMatch,
  SavedGuidanceValue,
} from '@shared/lib/guidance-value/types';

export const SCHEDULE_MAX_BYTES = 4 * 1024 * 1024;
export const SCHEDULE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const AREA_UNIT_OPTIONS: { value: AreaUnit; label: string }[] = [
  { value: 'sqft', label: 'sq.ft' },
  { value: 'sqm', label: 'sq.m' },
  { value: 'acre', label: 'acre' },
  { value: 'gunta', label: 'gunta' },
  { value: 'hectare', label: 'hectare' },
];

export const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: 'site', label: 'Site' },
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

export const USAGE_OPTIONS: { value: ScheduleUsage; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'agricultural', label: 'Agricultural' },
];

const CLASS_LABELS: Record<GuidanceRate['property_class'], string> = {
  residential_site: 'Residential site',
  residential_apartment: 'Residential apartment',
  commercial_site: 'Commercial site',
  commercial_apartment: 'Commercial apartment',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  other: 'Other',
};

export function scheduleRejection(
  mimeType: string | null | undefined,
  size: number | null | undefined
): string | null {
  if (!SCHEDULE_MIME_TYPES.includes((mimeType ?? '').toLowerCase())) {
    return 'Upload the schedule as a PDF or a JPEG, PNG or WebP photo.';
  }
  if (size && size > SCHEDULE_MAX_BYTES) {
    return 'That file is over 4 MB. Upload just the schedule page.';
  }
  return null;
}

export function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function rateLocation(
  rate: Pick<GuidanceRate, 'locality' | 'road' | 'village' | 'hobli' | 'taluk'>
): string {
  const parts = [rate.road, rate.locality, rate.village, rate.hobli, rate.taluk]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return [...new Set(parts)].join(', ') || 'Unnamed area';
}

export function rateHeadline(
  rate: Pick<GuidanceRate, 'rate' | 'unit' | 'property_class'>
): string {
  const unit = AREA_UNIT_OPTIONS.find((u) => u.value === rate.unit)?.label ?? rate.unit;
  return `${formatRupees(rate.rate)} / ${unit} · ${CLASS_LABELS[rate.property_class]}`;
}

export interface ScheduleDraft {
  locality: string;
  road: string;
  village: string;
  district: string;
  survey_number: string;
  kind: ScheduleKind | '';
  usage: ScheduleUsage | '';
  land_value: string;
  land_unit: AreaUnit;
  built_value: string;
  built_unit: AreaUnit;
}

export function draftFromSchedule(schedule: PropertySchedule): ScheduleDraft {
  return {
    locality: schedule.locality ?? '',
    road: schedule.road ?? '',
    village: schedule.village ?? '',
    district: schedule.district ?? '',
    survey_number: schedule.survey_number ?? '',
    kind: schedule.kind ?? '',
    usage: schedule.usage ?? '',
    land_value: schedule.land_area ? String(schedule.land_area.value) : '',
    land_unit: schedule.land_area?.unit ?? 'sqft',
    built_value: schedule.built_up_area ? String(schedule.built_up_area.value) : '',
    built_unit: schedule.built_up_area?.unit ?? 'sqft',
  };
}

export function scheduleFromDraft(
  draft: ScheduleDraft,
  base: PropertySchedule
): Record<string, unknown> {
  const area = (value: string, unit: AreaUnit) =>
    value.trim() ? { value: value.trim(), unit } : undefined;
  return {
    ...base,
    locality: draft.locality,
    road: draft.road,
    village: draft.village,
    district: draft.district,
    survey_number: draft.survey_number,
    kind: draft.kind || undefined,
    usage: draft.usage || undefined,
    land_area: area(draft.land_value, draft.land_unit),
    built_up_area: area(draft.built_value, draft.built_unit),
    floors: draft.built_value.trim() ? undefined : base.floors,
  };
}

export interface ValuationInputs {
  building_rate_per_sqft?: number | null;
}

export async function readSchedule(
  file: { uri: string; name: string; mimeType: string; size?: number | null },
  options: ValuationInputs = {}
): Promise<LookupResult> {
  const rejection = scheduleRejection(file.mimeType, file.size);
  if (rejection) throw new ApiError(415, rejection);
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  form.append('options', JSON.stringify(options));
  const { data } = await apiFetch<{ data: LookupResult }>(
    '/api/guidance-value/lookup',
    { method: 'POST', body: form, timeoutMs: 60_000 }
  );
  return data;
}

export async function matchSchedule(
  schedule: Record<string, unknown>,
  options: ValuationInputs = {}
): Promise<LookupResult> {
  const { data } = await apiFetch<{ data: LookupResult }>(
    '/api/guidance-value/lookup',
    { method: 'POST', body: JSON.stringify({ schedule, options }) }
  );
  return data;
}

export async function fetchSavedGuidanceValues(subject: {
  propertyId?: string | null;
  dealId?: string | null;
}): Promise<SavedGuidanceValue[]> {
  const query = subject.dealId
    ? `deal_id=${subject.dealId}`
    : `property_id=${subject.propertyId}`;
  const { data } = await apiFetch<{ data: SavedGuidanceValue[] }>(
    `/api/guidance-value/saved?${query}`
  );
  return data;
}

export async function saveGuidanceValue(input: {
  propertyId?: string | null;
  dealId?: string | null;
  rateId: string;
  schedule: Record<string, unknown>;
  options: ValuationInputs;
}): Promise<void> {
  await apiFetch('/api/guidance-value/saved', {
    method: 'POST',
    body: JSON.stringify({
      property_id: input.propertyId ?? undefined,
      deal_id: input.dealId ?? undefined,
      rate_id: input.rateId,
      schedule: input.schedule,
      options: input.options,
    }),
  });
}
