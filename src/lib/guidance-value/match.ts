import {
  PROPERTY_CLASS_LABELS,
  type GuidanceRate,
  type PropertyClass,
  type PropertySchedule,
  type RateMatch,
  type Valuation,
  type ValuationOptions,
} from './types';
import { ratePerSqft, toSqft } from './units';

const STOP_WORDS = new Set([
  'the',
  'of',
  'and',
  'at',
  'in',
  'no',
  'road',
  'rd',
  'street',
  'st',
  'bengaluru',
  'bangalore',
  'city',
  'area',
]);

const QUALIFIERS = ['block', 'stage', 'phase', 'sector', 'cross', 'main'];

const ROMAN: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

export function normaliseText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(value: string | null | undefined): string[] {
  return normaliseText(value)
    .split(' ')
    .map((token) => ROMAN[token] ?? token)
    .filter((token) => token && !STOP_WORDS.has(token));
}

export function qualifiers(
  value: string | null | undefined
): Map<string, string> {
  const words = normaliseText(value)
    .split(' ')
    .map((token) => ROMAN[token] ?? token);
  const out = new Map<string, string>();
  words.forEach((word, index) => {
    if (!QUALIFIERS.includes(word)) return;
    const before = words[index - 1];
    const after = words[index + 1];
    if (before && /^\d+[a-z]?$/.test(before)) out.set(word, before);
    else if (after && /^\d+[a-z]?$/.test(after)) out.set(word, after);
  });
  return out;
}

function isNameToken(token: string): boolean {
  return !/^\d+[a-z]?$/.test(token) && !QUALIFIERS.includes(token);
}

export function spellingKey(token: string): string {
  if (/\d/.test(token)) return token;
  const key = token
    .replace(/([bcdgjkpt])h/g, '$1')
    .replace(/sh/g, 's')
    .replace(/w/g, 'v')
    .replace(/ee/g, 'i')
    .replace(/oo|ou/g, 'u')
    .replace(/(.)\1+/g, '$1');
  return key.length > 3 ? key.replace(/[aeiu]$/, '') : key;
}

function overlap(needle: string[], haystack: string[]): number {
  if (needle.length === 0) return 0;
  const set = new Set(haystack.map(spellingKey));
  return (
    needle.filter((token) => set.has(spellingKey(token))).length / needle.length
  );
}

function conflicts(a: Map<string, string>, b: Map<string, string>): boolean {
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other !== undefined && other !== value) return true;
  }
  return false;
}

const SURVEY_ID = /\d+(?:\s*\/\s*[0-9a-z]+)*/g;

function surveyIds(text: string): string[] {
  return (text.toLowerCase().match(SURVEY_ID) ?? []).map((id) =>
    id.replace(/\s+/g, '')
  );
}

export function surveyNumbersCover(
  printed: string | null | undefined,
  surveyNumber: string | null | undefined
): boolean {
  const [target] = surveyIds(surveyNumber ?? '');
  if (!printed || !target) return false;
  const base = Number(target.split('/')[0]);
  const text = printed.toLowerCase();
  for (const range of text.matchAll(
    /(?<![\d/])(\d+)\s*(?:-|to)\s*(\d+)(?![\d/])/g
  )) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from <= to && base >= from && base <= to) return true;
  }
  return surveyIds(text).some(
    (id) => id === target || target.startsWith(`${id}/`)
  );
}

export function desiredClass(schedule: PropertySchedule): PropertyClass | null {
  const commercial = schedule.usage === 'commercial';
  switch (schedule.kind) {
    case 'apartment':
      return commercial ? 'commercial_apartment' : 'residential_apartment';
    case 'site':
    case 'house':
      return commercial ? 'commercial_site' : 'residential_site';
    case 'agricultural':
      return 'agricultural';
    case 'commercial':
      return 'commercial_site';
    case 'industrial':
      return 'industrial';
  }
  if (schedule.usage === 'agricultural') return 'agricultural';
  if (schedule.usage === 'industrial') return 'industrial';
  if (
    schedule.land_area?.unit === 'acre' ||
    schedule.land_area?.unit === 'gunta'
  ) {
    return 'agricultural';
  }
  if (commercial) return 'commercial_site';
  return null;
}

function isApartmentClass(propertyClass: PropertyClass): boolean {
  return (
    propertyClass === 'residential_apartment' ||
    propertyClass === 'commercial_apartment'
  );
}

function classFamily(propertyClass: PropertyClass): string {
  return propertyClass.split('_')[0];
}

function classFactor(
  desired: PropertyClass | null,
  actual: PropertyClass
): number {
  if (!desired) return actual === 'residential_site' ? 1 : 0.9;
  if (desired === actual) return 1;
  if (classFamily(desired) === classFamily(actual)) return 0.6;
  return 0.35;
}

export function builtUpSqft(
  schedule: PropertySchedule,
  override?: number | null
): number | null {
  if (override && override > 0) return override;
  if (schedule.built_up_area) return toSqft(schedule.built_up_area);
  if (schedule.floors?.length) {
    return schedule.floors.reduce((sum, floor) => sum + toSqft(floor.area), 0);
  }
  return null;
}

export function landSqft(
  schedule: PropertySchedule,
  override?: number | null
): number | null {
  if (override && override > 0) return override;
  return schedule.land_area ? toSqft(schedule.land_area) : null;
}

function round(value: number): number {
  return Math.round(value);
}

export function computeValuation(
  schedule: PropertySchedule,
  rate: Pick<GuidanceRate, 'rate' | 'unit' | 'property_class'>,
  options: ValuationOptions = {}
): Valuation {
  const perSqft = ratePerSqft(rate.rate, rate.unit);

  if (isApartmentClass(rate.property_class)) {
    const area = builtUpSqft(schedule, options.built_up_area_sqft);
    return {
      basis: 'built_up',
      area_sqft: area,
      rate_per_sqft: perSqft,
      land_value: null,
      building_value: null,
      total_value: area ? round(area * perSqft) : null,
      missing: area ? [] : ['built_up_area'],
    };
  }

  const land = landSqft(schedule, options.land_area_sqft);
  const builtUp = builtUpSqft(schedule, options.built_up_area_sqft);
  const buildingRate = options.building_rate_per_sqft;
  const buildingValue =
    buildingRate && buildingRate > 0 && builtUp
      ? round(builtUp * buildingRate)
      : null;
  const landValue = land ? round(land * perSqft) : null;

  return {
    basis: 'land',
    area_sqft: land,
    rate_per_sqft: perSqft,
    land_value: landValue,
    building_value: buildingValue,
    total_value: landValue === null ? null : landValue + (buildingValue ?? 0),
    missing: land ? [] : ['land_area'],
  };
}

export function scoreRate(
  schedule: PropertySchedule,
  rate: GuidanceRate,
  desired: PropertyClass | null
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const place = schedule.locality || schedule.village || schedule.city || '';
  const rateArea = [rate.locality, rate.village].filter(Boolean).join(' ');

  const placeTokens = tokens(place);
  const rateTokens = tokens(`${rateArea} ${rate.road ?? ''}`);
  const placeNames = placeTokens.filter(isNameToken);
  if (placeNames.length && overlap(placeNames, rateTokens) === 0) {
    return { score: 0, reasons: [] };
  }

  let locality = overlap(placeTokens, rateTokens);
  if (conflicts(qualifiers(place), qualifiers(rateArea))) {
    locality *= 0.2;
    reasons.push('Different block / stage in the same area');
  } else if (locality >= 0.99) {
    reasons.push(`Area matches ${rateArea || rate.road}`);
  } else if (locality > 0) {
    reasons.push(`Area partly matches ${rateArea || rate.road}`);
  }

  let road: number;
  const scheduleRoad = tokens(schedule.road);
  if (!rate.road) {
    road = scheduleRoad.length ? 0.5 : 0.6;
    reasons.push('Area-wide rate');
  } else if (!scheduleRoad.length) {
    road = 0.3;
  } else {
    const rateRoad = tokens(rate.road);
    road =
      overlap(scheduleRoad, rateRoad) >= 0.99 &&
      !conflicts(qualifiers(schedule.road), qualifiers(rate.road))
        ? 1
        : 0;
    reasons.push(
      road === 1
        ? `Rate for ${rate.road}`
        : `Rate is for a different road (${rate.road})`
    );
  }

  const survey = surveyNumbersCover(rate.survey_numbers, schedule.survey_number)
    ? 1
    : 0;
  if (survey) reasons.push(`Survey no. ${schedule.survey_number} is listed`);

  const factor = classFactor(desired, rate.property_class);
  if (desired && desired !== rate.property_class) {
    reasons.push(`${PROPERTY_CLASS_LABELS[rate.property_class]} rate`);
  }

  const base = 0.6 * locality + 0.3 * road + 0.1 * survey;
  return { score: Math.round(base * factor * 1000) / 1000, reasons };
}

export function rankMatches(
  schedule: PropertySchedule,
  rates: GuidanceRate[],
  options: ValuationOptions = {},
  limit = 8
): RateMatch[] {
  const desired = desiredClass(schedule);
  return rates
    .map((rate) => {
      const { score, reasons } = scoreRate(schedule, rate, desired);
      return {
        rate,
        score,
        reasons,
        valuation: computeValuation(schedule, rate, options),
      };
    })
    .filter((match) => match.score > 0.1)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.rate.effective_from ?? '').localeCompare(a.rate.effective_from ?? '')
    )
    .slice(0, limit);
}

export function searchQueries(schedule: PropertySchedule): string[] {
  const queries = [schedule.locality, schedule.village, schedule.city]
    .map((value) => normaliseText(value))
    .filter((value) => value.length >= 3);
  return [...new Set(queries)].slice(0, 2);
}

const DISTRICT_ALIASES: string[][] = [
  ['bengaluru', 'bangalore'],
  ['mysuru', 'mysore'],
  ['belagavi', 'belgaum'],
  ['kalaburagi', 'gulbarga'],
  ['shivamogga', 'shimoga'],
  ['tumakuru', 'tumkur'],
  ['ballari', 'bellary'],
  ['vijayapura', 'bijapur'],
  ['chikkamagaluru', 'chikmagalur'],
  ['mangaluru', 'mangalore'],
  ['dakshina kannada', 'mangalore'],
];

export function districtPattern(schedule: PropertySchedule): string | null {
  const head = normaliseText(schedule.district)
    .replace(/\b(urban|rural|district)\b/g, '')
    .trim();
  if (!head) return null;
  const names = new Set([head]);
  for (const group of DISTRICT_ALIASES) {
    if (group.some((name) => head.includes(name))) {
      group.forEach((name) => names.add(name));
    }
  }
  return `(${[...names].map((name) => name.replace(/\s+/g, '\\s*')).join('|')})`;
}
