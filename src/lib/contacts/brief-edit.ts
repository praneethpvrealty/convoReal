import {
  budgetToRupees,
  resolveBudgetBound,
  rupeesToBudgetAmount,
} from './budget-amount';

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
  noBudget: boolean;
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

function budgetEdited(shown: number | null, edited: number | null) {
  if (edited === shown) return false;
  if (shown === null) return true;
  const { amount, unit } = rupeesToBudgetAmount(shown);
  return edited !== budgetToRupees(amount, unit);
}

export function briefPrefPatch(
  opened: BriefFields,
  edit: BriefEdit,
  current: BriefFields = opened
): BriefPrefPatch {
  const patch: BriefPrefPatch = {};
  const kept = new Set(edit.areas.map(areaKey));
  const removed = new Set(
    (opened.pref_areas ?? [])
      .map(areaKey)
      .filter((key) => key && !kept.has(key))
  );
  const currentPrefAreas = current.pref_areas ?? [];
  const keptPrefAreas = currentPrefAreas.filter(
    (area) => !removed.has(areaKey(area))
  );
  if (keptPrefAreas.length !== currentPrefAreas.length) {
    patch.pref_areas = keptPrefAreas;
  }
  if (edit.noBudget) return patch;
  const shown = briefBudget(opened);
  if (
    positive(opened.pref_budget_min) !== null &&
    budgetEdited(shown.min, edit.minBudget)
  )
    patch.pref_budget_min = null;
  if (
    positive(opened.pref_budget_max) !== null &&
    budgetEdited(shown.max, edit.maxBudget)
  )
    patch.pref_budget_max = null;
  return patch;
}

export function briefAfterSave<T extends BriefFields>(
  opened: T,
  edit: BriefEdit,
  patch: BriefPrefPatch
): T {
  const kept = new Set(edit.areas.map(areaKey));
  return {
    ...opened,
    areas_of_interest: edit.areas,
    pref_areas: (opened.pref_areas ?? []).filter((area) =>
      kept.has(areaKey(area))
    ),
    min_budget: edit.minBudget,
    max_budget: edit.maxBudget,
    pref_budget_min:
      'pref_budget_min' in patch ? null : (opened.pref_budget_min ?? null),
    pref_budget_max:
      'pref_budget_max' in patch ? null : (opened.pref_budget_max ?? null),
  };
}
