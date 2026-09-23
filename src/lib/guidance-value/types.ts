export const AREA_UNITS = ['sqft', 'sqm', 'acre', 'gunta', 'hectare'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

export const PROPERTY_CLASSES = [
  'residential_site',
  'residential_apartment',
  'commercial_site',
  'commercial_apartment',
  'industrial',
  'agricultural',
  'other',
] as const;
export type PropertyClass = (typeof PROPERTY_CLASSES)[number];

export const PROPERTY_CLASS_LABELS: Record<PropertyClass, string> = {
  residential_site: 'Residential site',
  residential_apartment: 'Residential apartment',
  commercial_site: 'Commercial site',
  commercial_apartment: 'Commercial apartment',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  other: 'Other',
};

export const SCHEDULE_KINDS = [
  'site',
  'house',
  'apartment',
  'agricultural',
  'commercial',
  'industrial',
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_USAGES = [
  'residential',
  'commercial',
  'industrial',
  'agricultural',
] as const;
export type ScheduleUsage = (typeof SCHEDULE_USAGES)[number];

export interface Area {
  value: number;
  unit: AreaUnit;
}

export interface ScheduleFloor {
  label: string;
  area: Area;
}

export interface Boundaries {
  east?: string;
  west?: string;
  north?: string;
  south?: string;
}

export interface PropertySchedule {
  state?: string;
  district?: string;
  taluk?: string;
  hobli?: string;
  village?: string;
  city?: string;
  locality?: string;
  road?: string;
  pincode?: string;
  municipal_number?: string;
  pid?: string;
  survey_number?: string;
  khata_number?: string;
  kind?: ScheduleKind;
  usage?: ScheduleUsage;
  land_area?: Area;
  built_up_area?: Area;
  floors?: ScheduleFloor[];
  boundaries?: Boundaries;
  summary?: string;
}

export interface GuidanceRate {
  id: string;
  source_id: string;
  district: string | null;
  taluk: string | null;
  hobli: string | null;
  village: string | null;
  locality: string | null;
  road: string | null;
  survey_numbers: string | null;
  property_class: PropertyClass;
  rate: number;
  unit: AreaUnit;
  page: number | null;
  source_title: string | null;
  effective_from: string | null;
  similarity?: number;
}

export interface ParsedRateRow {
  district?: string;
  taluk?: string;
  hobli?: string;
  village?: string;
  locality?: string;
  road?: string;
  survey_numbers?: string;
  property_class: PropertyClass;
  rate: number;
  unit: AreaUnit;
  page?: number;
}

export interface Valuation {
  basis: 'land' | 'built_up';
  area_sqft: number | null;
  rate_per_sqft: number;
  land_value: number | null;
  building_value: number | null;
  total_value: number | null;
  missing: Array<'land_area' | 'built_up_area'>;
}

export interface RateMatch {
  rate: GuidanceRate;
  score: number;
  reasons: string[];
  valuation: Valuation;
}

export interface ValuationOptions {
  land_area_sqft?: number | null;
  built_up_area_sqft?: number | null;
  building_rate_per_sqft?: number | null;
}

export interface LookupResult {
  schedule: PropertySchedule;
  desired_class: PropertyClass | null;
  matches: RateMatch[];
  coverage: 'matched' | 'no_rates' | 'no_match';
}

export interface SavedGuidanceValue {
  id: string;
  property_id: string | null;
  deal_id: string | null;
  schedule: PropertySchedule;
  rate_id: string | null;
  rate_snapshot: Partial<GuidanceRate>;
  land_area_sqft: number | null;
  built_up_area_sqft: number | null;
  land_value: number | null;
  building_value: number | null;
  total_value: number;
  created_at: string;
}
