import { resolveBudgetBound } from './budget-amount';

export interface BriefFields {
  areas_of_interest?: string[] | null;
  pref_areas?: string[] | null;
  min_budget?: number | string | null;
  max_budget?: number | string | null;
  pref_budget_min?: number | string | null;
  pref_budget_max?: number | string | null;
}

export interface BriefEdit {
  areas: string[];
  minBudget: number | null;
  maxBudget: number | null;
}

export interface BriefPrefPatch {
  pref_areas?: string[];
  pref_budget_min?: null;
  pref_budget_max?: null;
}

const areaKey = (area: string) => area.trim().toLowerCase();

const positive = (value: number | string | null | undefined) =>
  value != null && Number(value) > 0 ? Number(value) : null;

export function briefAreas(source: BriefFields): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const area of [
    ...(source.areas_of_interest ?? []),
    ...(source.pref_areas ?? []),
  ]) {
    const key = areaKey(area);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    areas.push(area.trim());
  }
  return areas;
}

export function briefBudget(source: BriefFields): {
  min: number | null;
  max: number | null;
} {
  return {
    min: resolveBudgetBound(
      positive(source.min_budget),
      positive(source.pref_budget_min)
    ),
    max: resolveBudgetBound(
      positive(source.max_budget),
      positive(source.pref_budget_max)
    ),
  };
}

export function briefPrefPatch(
  opened: BriefFields,
  edit: BriefEdit
): BriefPrefPatch {
  const patch: BriefPrefPatch = {};
  const kept = new Set(edit.areas.map(areaKey));
  const prefAreas = opened.pref_areas ?? [];
  const keptPrefAreas = prefAreas.filter((area) => kept.has(areaKey(area)));
  if (keptPrefAreas.length !== prefAreas.length) {
    patch.pref_areas = keptPrefAreas;
  }
  const shown = briefBudget(opened);
  if (positive(opened.pref_budget_min) !== null && edit.minBudget !== shown.min)
    patch.pref_budget_min = null;
  if (positive(opened.pref_budget_max) !== null && edit.maxBudget !== shown.max)
    patch.pref_budget_max = null;
  return patch;
}
