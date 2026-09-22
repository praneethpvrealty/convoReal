/**
 * The Requirements screen's derivations — stats, filtering and the
 * explicit-over-AI preference merge the cards display.
 *
 * Kept apart from lib/requirements.ts because that file reaches
 * api.ts and so pulls in React Native, which has no runtime under the
 * plain Node test runner (root AGENTS.md §12). Same split as
 * gaps.ts / gaps-feed.ts.
 *
 * Mirrors src/lib/contact-preferences.ts and the filter semantics of
 * src/app/(dashboard)/requirements/requirements-content.tsx.
 */

import type { Contact } from '@shared/types';

import { areasMatchSearch } from './contact-area-options';
import { resolveRequirementSource } from './requirements-profile';

export interface RequirementRow extends Contact {
  contact_notes?: { note_text: string }[] | null;
  contact_tags?: { tags?: { name?: string | null } | null }[] | null;
  conversations?: { id: string }[] | null;
}

export interface EffectiveValue<T> {
  value: T;
  source: 'explicit' | 'ai';
}

export type RequirementClassification = 'All' | 'Buyer' | 'Agent';
export type RequirementPriority = 'All' | 'High' | 'Medium' | 'Low';

export const REQUIREMENT_CLASSIFICATIONS: {
  key: RequirementClassification;
  label: string;
}[] = [
  { key: 'All', label: 'All types' },
  { key: 'Buyer', label: 'Buyers' },
  { key: 'Agent', label: 'Agents' },
];

export const REQUIREMENT_PRIORITIES: {
  key: RequirementPriority;
  label: string;
}[] = [
  { key: 'All', label: 'All priorities' },
  { key: 'High', label: 'High' },
  { key: 'Medium', label: 'Medium' },
  { key: 'Low', label: 'Low' },
];

function positiveNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonEmpty(v: string[] | null | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  const cleaned = v
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

export function effectiveMaxBudget(c: Contact): EffectiveValue<number> | null {
  const explicit = positiveNumber(c.max_budget);
  if (explicit !== null) return { value: explicit, source: 'explicit' };
  const ai = positiveNumber(c.pref_budget_max);
  return ai !== null ? { value: ai, source: 'ai' } : null;
}

export function effectiveAreas(c: Contact): EffectiveValue<string[]> | null {
  const explicit = nonEmpty(c.areas_of_interest);
  if (explicit) return { value: explicit, source: 'explicit' };
  const ai = nonEmpty(c.pref_areas);
  return ai ? { value: ai, source: 'ai' } : null;
}

export function effectiveCategories(
  c: Contact
): EffectiveValue<string[]> | null {
  const explicit = nonEmpty(c.property_interests);
  if (explicit) return { value: explicit, source: 'explicit' };
  const cats = (nonEmpty(c.pref_property_categories) ?? []).map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1)
  );
  const types = nonEmpty(c.pref_property_types) ?? [];
  const seen = new Set<string>();
  const merged = [...cats, ...types].filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? { value: merged, source: 'ai' } : null;
}

export function visibleTagSuggestions(
  suggested: string[] | null | undefined,
  attachedTagNames: (string | null | undefined)[]
): string[] {
  const cleaned = nonEmpty(Array.isArray(suggested) ? suggested : null);
  if (!cleaned) return [];
  const attached = new Set(
    attachedTagNames
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );
  const seen = new Set<string>();
  return cleaned.filter((s) => {
    const key = s.toLowerCase();
    if (attached.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function attachedTagNames(row: RequirementRow): string[] {
  return (row.contact_tags || [])
    .map((t) => t.tags?.name)
    .filter((n): n is string => Boolean(n));
}

export function latestNote(row: RequirementRow): string | null {
  const note = (row.contact_notes || [])[0]?.note_text;
  return note?.trim() ? note : null;
}

export interface RequirementStats {
  total: number;
  hot: number;
  buyers: number;
  agents: number;
}

export function requirementStats(rows: RequirementRow[]): RequirementStats {
  return {
    total: rows.length,
    hot: rows.filter((c) => c.lead_temp === 'HOT').length,
    buyers: rows.filter((c) => c.classification === 'Buyer').length,
    agents: rows.filter((c) => c.classification === 'Agent').length,
  };
}

export function matchesPriority(
  row: RequirementRow,
  priority: RequirementPriority
): boolean {
  if (priority === 'All') return true;
  if (priority === 'High') return row.lead_temp === 'HOT';
  if (priority === 'Medium')
    return Boolean(
      row.lead_temp && row.lead_temp !== 'HOT' && row.lead_temp !== 'Dead'
    );
  return !row.lead_temp || row.lead_temp === 'Dead';
}

export interface RequirementFilters {
  search: string;
  classification: RequirementClassification;
  priority: RequirementPriority;
}

export const EMPTY_REQUIREMENT_FILTERS: RequirementFilters = {
  search: '',
  classification: 'All',
  priority: 'All',
};

export function activeRequirementFilterCount(
  filters: RequirementFilters
): number {
  return [filters.classification, filters.priority].filter((v) => v !== 'All')
    .length;
}

export function filterRequirements(
  rows: RequirementRow[],
  filters: RequirementFilters
): RequirementRow[] {
  const term = filters.search.trim();
  const lower = term.toLowerCase();
  return rows.filter((row) => {
    const source = resolveRequirementSource(row) as RequirementRow;
    const areas = [
      ...(source.areas_of_interest ?? []),
      ...(source.pref_areas ?? []),
    ];
    const searchMatch =
      !term ||
      Boolean(row.name?.toLowerCase().includes(lower)) ||
      Boolean(row.phone?.includes(term)) ||
      Boolean(source.requirements?.toLowerCase().includes(lower)) ||
      (row.contact_notes || []).some((n) =>
        n.note_text.toLowerCase().includes(lower)
      ) ||
      areas.some((a) => a.toLowerCase().includes(lower)) ||
      areasMatchSearch(term, areas);
    const classMatch =
      filters.classification === 'All' ||
      row.classification === filters.classification;
    return searchMatch && classMatch && matchesPriority(row, filters.priority);
  });
}

export function requirementCurrency(value: number): string {
  if (value >= 10000000)
    return `₹${(value / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (value >= 100000)
    return `₹${(value / 100000).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

export function requirementBudgetLabel(row: RequirementRow): {
  text: string;
  ai: boolean;
} {
  const source = resolveRequirementSource(row);
  if (source.no_budget) return { text: 'No limit', ai: false };
  const budget = effectiveMaxBudget(source);
  if (!budget) return { text: 'Not specified', ai: false };
  return {
    text: requirementCurrency(budget.value),
    ai: budget.source === 'ai',
  };
}
