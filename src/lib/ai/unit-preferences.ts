export const FACING_VALUES = [
  'East',
  'North',
  'South',
  'West',
  'North-East',
  'North-West',
  'South-East',
  'South-West',
] as const;

export type Facing = (typeof FACING_VALUES)[number];

export interface UnitPreferences {
  facing: Facing[];
  towers: string[];
  floor_min: number | null;
  floor_max: number | null;
}

export const EMPTY_UNIT_PREFERENCES: UnitPreferences = {
  facing: [],
  towers: [],
  floor_min: null,
  floor_max: null,
};

const MAX_FLOOR = 150;
const MAX_TEXT_LENGTH = 4000;

const DIRECTION = String.raw`(?:north|south)[\s-]{0,3}(?:east|west)|north|south|east|west|\b(?:ne|nw|se|sw)\b`;
const DIRECTION_LIST = String.raw`(?:${DIRECTION})(?:\s{0,3}(?:,|\/|&|or|and)\s{0,3}(?:${DIRECTION}))*`;
const FACING_BEFORE = new RegExp(
  String.raw`(\b(?:not|no|non|except|avoid|other than)\s{1,3})?(${DIRECTION_LIST})[\s-]{0,3}fac(?:ing|e)\b`,
  'gi'
);
const FACING_AFTER = new RegExp(
  String.raw`\bfacing\s{0,3}(?:is|should be|must be|:|-|–)?\s{0,3}(?:towards\s|to\s)?(${DIRECTION_LIST})\b(?![\s-]{0,3}fac)`,
  'gi'
);
const ONE_DIRECTION = new RegExp(DIRECTION, 'gi');

const ABBREVIATED: Record<string, Facing> = {
  ne: 'North-East',
  nw: 'North-West',
  se: 'South-East',
  sw: 'South-West',
};

export function normalizeFacing(
  value: string | null | undefined
): Facing | null {
  const clean = (value || '').trim().toLowerCase();
  if (!clean) return null;
  if (ABBREVIATED[clean]) return ABBREVIATED[clean];
  const parts = clean.match(/north|south|east|west/g);
  if (!parts || parts.length === 0 || parts.length > 2) return null;
  const label = parts
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('-');
  return (FACING_VALUES as readonly string[]).includes(label)
    ? (label as Facing)
    : null;
}

function facingFromText(text: string): Facing[] {
  const wanted: Facing[] = [];
  const add = (list: string) => {
    for (const match of list.match(ONE_DIRECTION) ?? []) {
      const facing = normalizeFacing(match);
      if (facing && !wanted.includes(facing)) wanted.push(facing);
    }
  };
  for (const match of text.matchAll(FACING_BEFORE)) {
    if (!match[1]) add(match[2]);
  }
  for (const match of text.matchAll(FACING_AFTER)) add(match[1]);
  return wanted;
}

const TOWER_TOKEN = String.raw`(?:\d{1,3}[A-Za-z]?|[A-Z])`;
const TOWER_KEYWORD = String.raw`(?:[Tt]owers?|TOWERS?|[Ww]ings?|WINGS?)`;
const TOWER_LIST = new RegExp(
  String.raw`\b${TOWER_KEYWORD}\s{0,3}(?:no\.?|number|#|:|-)?\s{0,3}(${TOWER_TOKEN}(?:\s{0,3}(?:,|\/|&|or|and)\s{0,3}${TOWER_TOKEN})*)(?![A-Za-z0-9])`,
  'g'
);

export function normalizeTower(
  value: string | null | undefined
): string | null {
  const clean = (value || '')
    .replace(/\b(?:towers?|wings?|blocks?|no\.?|number)\b/gi, ' ')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase()
    .replace(/^0+(?=\d)/, '');
  return clean || null;
}

function towersFromText(text: string): string[] {
  const towers: string[] = [];
  for (const match of text.matchAll(TOWER_LIST)) {
    for (const token of match[1].split(/,|\/|&|\bor\b|\band\b/)) {
      const tower = normalizeTower(token);
      if (tower && !towers.includes(tower)) towers.push(tower);
    }
  }
  return towers;
}

const ORDINAL = String.raw`(\d{1,3})(?:\s{0,3}(?:st|nd|rd|th))?`;
const FLOOR_WORD = String.raw`(?:floors?|flr)`;
const RANGE_JOIN = String.raw`\s{0,3}(?:-|–|—|to|and|till|until)\s{0,3}`;
const FLOOR_RANGE_BEFORE = new RegExp(
  String.raw`\b(?:(?:above|from|between)\s{1,3})?${ORDINAL}${RANGE_JOIN}${ORDINAL}\s{0,3}${FLOOR_WORD}\b`,
  'i'
);
const FLOOR_RANGE_AFTER = new RegExp(
  String.raw`\b${FLOOR_WORD}\s{0,3}(?:no\.?|number|:|-)?\s{0,3}(?:between\s{1,3}|from\s{1,3})?${ORDINAL}${RANGE_JOIN}${ORDINAL}\b`,
  'i'
);
const FLOOR_AT_LEAST = new RegExp(
  String.raw`\b${ORDINAL}\s{0,3}${FLOOR_WORD}\s{0,3}(?:and|or|&)\s{0,3}(?:above|higher|up|upwards)\b|\b(?:min(?:imum)?|at\s{0,3}least)\s{1,3}${ORDINAL}\s{0,3}${FLOOR_WORD}\b`,
  'i'
);
const FLOOR_ABOVE = new RegExp(
  String.raw`\b(?:above|higher than|over|beyond)\s{1,3}(?:the\s{1,3})?${ORDINAL}\s{0,3}${FLOOR_WORD}\b`,
  'i'
);
const FLOOR_AT_MOST = new RegExp(
  String.raw`\b${ORDINAL}\s{0,3}${FLOOR_WORD}\s{0,3}(?:and|or|&)\s{0,3}(?:below|lower|down)\b|\b(?:up\s{0,3}to|upto|max(?:imum)?|within|not above|at\s{0,3}most)\s{1,3}(?:the\s{1,3})?${ORDINAL}\s{0,3}${FLOOR_WORD}\b`,
  'i'
);
const FLOOR_BELOW = new RegExp(
  String.raw`\b(?:below|lower than|under)\s{1,3}(?:the\s{1,3})?${ORDINAL}\s{0,3}${FLOOR_WORD}\b`,
  'i'
);
const FLOOR_SINGLE = new RegExp(
  String.raw`\b(\d{1,3})\s{0,3}(?:st|nd|rd|th)\s{0,3}${FLOOR_WORD}\b|\b${FLOOR_WORD}\s{0,3}(?:no\.?|number|#)\s{0,3}(\d{1,3})\b`,
  'i'
);
const GROUND_FLOOR = /\bground\s{0,3}(?:floor|flr)\b/i;

function floorNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_FLOOR
    ? parsed
    : null;
}

function firstFloor(match: RegExpExecArray | null): number | null {
  if (!match) return null;
  for (const group of match.slice(1)) {
    const floor = floorNumber(group);
    if (floor != null) return floor;
  }
  return null;
}

function floorsFromText(text: string): {
  floor_min: number | null;
  floor_max: number | null;
} {
  const range = FLOOR_RANGE_BEFORE.exec(text) ?? FLOOR_RANGE_AFTER.exec(text);
  if (range) {
    const first = floorNumber(range[1]);
    const second = floorNumber(range[2]);
    if (first != null && second != null) {
      return {
        floor_min: Math.min(first, second),
        floor_max: Math.max(first, second),
      };
    }
  }

  const atLeast = firstFloor(FLOOR_AT_LEAST.exec(text));
  const above = firstFloor(FLOOR_ABOVE.exec(text));
  const atMost = firstFloor(FLOOR_AT_MOST.exec(text));
  const below = firstFloor(FLOOR_BELOW.exec(text));
  const floorMin = atLeast ?? (above != null ? above + 1 : null);
  const floorMax = atMost ?? (below != null ? Math.max(0, below - 1) : null);
  if (floorMin != null || floorMax != null) {
    return floorMin != null && floorMax != null && floorMin > floorMax
      ? { floor_min: floorMin, floor_max: null }
      : { floor_min: floorMin, floor_max: floorMax };
  }

  const single = firstFloor(FLOOR_SINGLE.exec(text));
  if (single != null) return { floor_min: single, floor_max: single };
  if (GROUND_FLOOR.test(text)) return { floor_min: 0, floor_max: 0 };
  return { floor_min: null, floor_max: null };
}

export function unitPreferencesFromRequirement(
  text: string | null | undefined
): UnitPreferences {
  const value = (text || '').trim().slice(0, MAX_TEXT_LENGTH);
  if (!value) return EMPTY_UNIT_PREFERENCES;
  return {
    facing: facingFromText(value),
    towers: towersFromText(value),
    ...floorsFromText(value),
  };
}

export function sanitizeUnitPreferences(value: {
  facing?: unknown;
  towers?: unknown;
  floor_min?: unknown;
  floor_max?: unknown;
}): UnitPreferences {
  const strings = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : [];
  const facing = strings(value.facing)
    .map((item) => normalizeFacing(item))
    .filter((item): item is Facing => !!item);
  const towers = strings(value.towers)
    .map((item) => normalizeTower(item))
    .filter((item): item is string => !!item);
  const floor = (raw: unknown): number | null =>
    raw == null || raw === '' ? null : floorNumber(String(raw));
  return {
    facing: [...new Set(facing)],
    towers: [...new Set(towers)],
    floor_min: floor(value.floor_min),
    floor_max: floor(value.floor_max),
  };
}

export interface UnitPreferenceSource {
  facing?: readonly string[] | null;
  towers?: readonly string[] | null;
  floor_min?: number | null;
  floor_max?: number | null;
}

export function hasUnitPreferences(
  prefs: UnitPreferenceSource | null | undefined
): boolean {
  return Boolean(
    prefs &&
    (prefs.facing?.length ||
      prefs.towers?.length ||
      prefs.floor_min != null ||
      prefs.floor_max != null)
  );
}

function ordinal(floor: number): string {
  if (floor === 0) return 'Ground';
  const tens = floor % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][floor % 10] ?? 'th');
  return `${floor}${suffix}`;
}

export function floorRangeLabel(
  min: number | null | undefined,
  max: number | null | undefined
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    return min === max
      ? `${ordinal(min)} floor`
      : `${ordinal(min)}–${ordinal(max)} floor`;
  }
  return min != null
    ? `${ordinal(min)} floor and above`
    : `Up to ${ordinal(max as number)} floor`;
}

export function unitPreferenceLabels(
  prefs: UnitPreferenceSource | null | undefined
): string[] {
  if (!prefs) return [];
  return [
    prefs.facing?.length ? `${prefs.facing.join(' / ')} facing` : null,
    prefs.towers?.length ? `Tower ${prefs.towers.join(' / ')}` : null,
    floorRangeLabel(prefs.floor_min, prefs.floor_max),
  ].filter((label): label is string => !!label);
}
