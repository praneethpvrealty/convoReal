import {
  PROPERTY_CLASS_LABELS,
  type Area,
  type AreaUnit,
  type GuidanceRate,
  type PropertySchedule,
} from './types';
import { UNIT_LABELS, formatInr } from './units';

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
  return `${formatInr(rate.rate)} / ${UNIT_LABELS[rate.unit]} · ${PROPERTY_CLASS_LABELS[rate.property_class]}`;
}

export function perSqftText(ratePerSqft: number): string {
  return `≈ ${formatInr(ratePerSqft)} / sq.ft`;
}

export function rateSourceText(
  rate: Pick<GuidanceRate, 'source_title' | 'effective_from' | 'page'>
): string {
  return [
    rate.source_title,
    rate.effective_from ? `effective ${rate.effective_from}` : null,
    rate.page ? `page ${rate.page}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function areaText(area: Area | undefined): string | null {
  return area
    ? `${area.value.toLocaleString('en-IN')} ${UNIT_LABELS[area.unit]}`
    : null;
}

export function scheduleHeadline(schedule: PropertySchedule): string {
  const place = [
    schedule.municipal_number ? `No. ${schedule.municipal_number}` : null,
    schedule.road,
    schedule.locality,
    schedule.village,
    schedule.city,
  ]
    .filter(Boolean)
    .join(', ');
  return place || 'Property schedule';
}

export interface ScheduleForm {
  district: string;
  taluk: string;
  hobli: string;
  village: string;
  locality: string;
  road: string;
  survey_number: string;
  kind: string;
  usage: string;
  land_value: string;
  land_unit: AreaUnit;
  built_value: string;
  built_unit: AreaUnit;
}

export function scheduleToForm(schedule: PropertySchedule): ScheduleForm {
  return {
    district: schedule.district ?? '',
    taluk: schedule.taluk ?? '',
    hobli: schedule.hobli ?? '',
    village: schedule.village ?? '',
    locality: schedule.locality ?? '',
    road: schedule.road ?? '',
    survey_number: schedule.survey_number ?? '',
    kind: schedule.kind ?? '',
    usage: schedule.usage ?? '',
    land_value: schedule.land_area ? String(schedule.land_area.value) : '',
    land_unit: schedule.land_area?.unit ?? 'sqft',
    built_value: schedule.built_up_area
      ? String(schedule.built_up_area.value)
      : '',
    built_unit: schedule.built_up_area?.unit ?? 'sqft',
  };
}

export function formToSchedule(
  form: ScheduleForm,
  base: PropertySchedule = {}
): Record<string, unknown> {
  const area = (value: string, unit: AreaUnit) =>
    value.trim() ? { value: value.trim(), unit } : undefined;
  return {
    ...base,
    district: form.district,
    taluk: form.taluk,
    hobli: form.hobli,
    village: form.village,
    locality: form.locality,
    road: form.road,
    survey_number: form.survey_number,
    kind: form.kind || undefined,
    usage: form.usage || undefined,
    land_area: area(form.land_value, form.land_unit),
    built_up_area: area(form.built_value, form.built_unit),
    floors: form.built_value.trim() ? undefined : base.floors,
  };
}
