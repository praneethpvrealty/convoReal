/**
 * Shared constants + pure helpers for the Journey mind map.
 *
 * A "journey" is the funnel of one relationship: in buyer mode the
 * subject is a contact and the moving pieces are properties; in
 * property (seller) mode the subject is a property and the moving
 * pieces are contacts. Both directions read the same journey_items
 * rows — only the grouping column differs.
 */

import { differenceInCalendarDays } from 'date-fns';

import {
  JOURNEY_PRIORITY_LABELS,
  JOURNEY_PRIORITY_RANKS,
  type JourneyPriority,
} from '@/lib/journey/sort';
import type { JourneyItem, JourneyStage, JourneyStageKind } from '@/types';

export type JourneyMode = 'buyer' | 'property';

/** Seeded on first visit when the account has no stages yet —
 *  mirrors how the kanban seeds its default pipeline. Fully
 *  editable afterwards via the stage editor. */
export const DEFAULT_JOURNEY_STAGES: {
  name: string;
  color: string;
  kind: JourneyStageKind;
}[] = [
  { name: 'Shared', color: '#3b82f6', kind: 'prospecting' }, // blue
  { name: 'Shortlisted', color: '#eab308', kind: 'prospecting' }, // yellow
  { name: 'Visited', color: '#f97316', kind: 'prospecting' }, // orange
  { name: 'Owner Meeting', color: '#8b5cf6', kind: 'prospecting' }, // violet
  { name: 'Token & Legal', color: '#06b6d4', kind: 'closing' }, // cyan
  { name: 'Registration', color: '#10b981', kind: 'closing' }, // emerald
  { name: 'Brokerage Paid', color: '#22c55e', kind: 'won' }, // green
];

/** Stage kinds that put a relationship past the enquiry. A contact
 *  sitting on one of these is out of the follow-up radar: they are
 *  quiet on WhatsApp because the work moved to lawyers and the
 *  sub-registrar, not because they went cold. */
export const PAST_ENQUIRY_STAGE_KINDS: JourneyStageKind[] = ['closing', 'won'];

/** Stage kinds the closing card watches. Narrower than
 *  PAST_ENQUIRY_STAGE_KINDS on purpose: a won deal is out of the
 *  enquiry radar AND has nothing left to chase, so it is carded to
 *  nobody. */
export const CLOSING_STAGE_KINDS: JourneyStageKind[] = ['closing'];

export const JOURNEY_STAGE_KIND_META: Record<
  JourneyStageKind,
  { label: string; hint: string }
> = {
  prospecting: {
    label: 'Prospecting',
    hint: 'Still being worked as an enquiry — the follow-up radar chases it.',
  },
  closing: {
    label: 'Closing',
    hint: 'Token paid, legal or registration under way — no enquiry check-ins.',
  },
  won: { label: 'Won', hint: 'Deal completed.' },
  lost: { label: 'Lost', hint: 'Deal died.' },
};

export const JOURNEY_STAGE_KIND_ORDER: JourneyStageKind[] = [
  'prospecting',
  'closing',
  'won',
  'lost',
];

export {
  DEFAULT_JOURNEY_SORT,
  JOURNEY_PRIORITY_ORDER,
  JOURNEY_SORT_LABELS,
  QUICK_DROP_REASONS,
  priorityRank,
  sortJourneys,
  type JourneyPriority,
  type JourneySort,
  type RankableJourney,
} from '@/lib/journey/sort';

/** Priority ladder for the overview — `rank` drives sorting (lower
 *  first), unrated journeys fall to the bottom with rank 3. */
export const JOURNEY_PRIORITY_META: Record<
  JourneyPriority,
  { label: string; rank: number; className: string; dot: string }
> = {
  high: {
    label: JOURNEY_PRIORITY_LABELS.high,
    rank: JOURNEY_PRIORITY_RANKS.high,
    className: 'border-red-500/40 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
  },
  medium: {
    label: JOURNEY_PRIORITY_LABELS.medium,
    rank: JOURNEY_PRIORITY_RANKS.medium,
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  low: {
    label: JOURNEY_PRIORITY_LABELS.low,
    rank: JOURNEY_PRIORITY_RANKS.low,
    className: 'border-slate-600 bg-slate-800/60 text-slate-300',
    dot: 'bg-slate-400',
  },
};

/** Swatches offered by the stage editor. */
export const STAGE_COLOR_CHOICES = [
  '#3b82f6',
  '#eab308',
  '#f97316',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#22c55e',
  '#ec4899',
  '#ef4444',
  '#64748b',
];

/**
 * Navigate between journey views (overview ⇄ focused ⇄ mode tabs).
 *
 * These are all SAME-PATHNAME navigations (/journey with different
 * search params), which the app router swallows in production builds —
 * see src/lib/navigation.ts for the full story. All journey callers
 * are already on /journey, so this goes straight to the History API.
 */
export function navigateJourney(url: string) {
  window.history.pushState(null, '', url);
}

/** Human label for a planned step's expected date — "In 25 days",
 *  "Tomorrow", "Today", or "3 days overdue" once it slips. */
export function planEtaLabel(plannedAt: string): {
  text: string;
  overdue: boolean;
} {
  const days = differenceInCalendarDays(new Date(plannedAt), new Date());
  if (days > 1) return { text: `In ${days} days`, overdue: false };
  if (days === 1) return { text: 'Tomorrow', overdue: false };
  if (days === 0) return { text: 'Today', overdue: false };
  return {
    text: `${-days} day${days === -1 ? '' : 's'} overdue`,
    overdue: true,
  };
}

/** The item's valid planned-stage index: only meaningful for active
 *  items planning a stage AHEAD of where they are. -1 otherwise. */
export function plannedIndexOf(
  item: JourneyItem,
  stages: JourneyStage[]
): number {
  if (item.status !== 'active' || !item.planned_stage_id) return -1;
  const planned = stages.findIndex((s) => s.id === item.planned_stage_id);
  return planned > stageIndexOf(item, stages) ? planned : -1;
}

/** Index of an item's furthest-reached stage in the ordered stage
 *  list; -1 when the stage was deleted out from under it (defensive —
 *  the editor blocks deleting stages with items). */
export function stageIndexOf(
  item: JourneyItem,
  stages: JourneyStage[]
): number {
  return stages.findIndex((s) => s.id === item.stage_id);
}

/** Row order on the canvas: furthest-travelled first so the map reads
 *  as a funnel (top rows reach the right edge, lower rows stop
 *  early), active before dropped at the same depth, then oldest
 *  first for stability. */
export function sortItemsForRows(
  items: JourneyItem[],
  stages: JourneyStage[]
): JourneyItem[] {
  return [...items].sort((a, b) => {
    const ai = stageIndexOf(a, stages);
    const bi = stageIndexOf(b, stages);
    if (ai !== bi) return bi - ai;
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export interface JourneyEnquirySummary {
  enquiryCount: number;
  lastEnquiredAt: string | null;
  lastEnquirySource: string | null;
  enquirySourceCount: number;
}

export function journeyEnquiryLabel(
  {
    enquiryCount,
    lastEnquiredAt,
    lastEnquirySource,
    enquirySourceCount,
  }: JourneyEnquirySummary,
  now: Date = new Date()
): string | null {
  if (enquiryCount <= 0) return null;
  const parts = [
    enquiryCount === 1 ? '1 enquiry' : `${enquiryCount} enquiries`,
  ];
  if (lastEnquirySource) {
    parts.push(
      enquirySourceCount > 1
        ? `${lastEnquirySource} +${enquirySourceCount - 1}`
        : lastEnquirySource
    );
  }
  const date = lastEnquiredAt ? new Date(lastEnquiredAt) : null;
  if (date && !Number.isNaN(date.getTime())) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const day = `${date.getDate()} ${months[date.getMonth()]}`;
    parts.push(
      date.getFullYear() === now.getFullYear()
        ? day
        : `${day} ${date.getFullYear()}`
    );
  }
  return parts.join(' · ');
}

export interface JourneyEnquirySourceOption {
  source: string;
  count: number;
}

export function journeyEnquirySourceOptions(
  groups: { enquirySources: string[] }[],
  selected: string | null = null
): JourneyEnquirySourceOption[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const source of group.enquirySources) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  if (selected && !counts.has(selected)) counts.set(selected, 0);
  return [...counts]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

export function normalizeJourneyEnquirySource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  return source || null;
}

export function matchesJourneyEnquirySource(
  group: { enquirySources: string[] },
  source: string | null
): boolean {
  return !source || group.enquirySources.includes(source);
}

export function journeyViewCounts(
  groups: {
    archivedAt: string | null;
    lifecycleStatus: string;
    enquirySources: string[];
  }[],
  source: string | null
): { active: number; closed: number; archived: number } {
  const counts = { active: 0, closed: 0, archived: 0 };
  for (const group of groups) {
    if (!matchesJourneyEnquirySource(group, source)) continue;
    if (group.archivedAt) counts.archived += 1;
    else if (group.lifecycleStatus === 'active') counts.active += 1;
    else counts.closed += 1;
  }
  return counts;
}

export function journeyRaceLabel(active: number): string {
  return active > 0 ? `${active} in the race` : 'Nothing in the race';
}

export function splitItemsAtStage<
  T extends { stage_id: string; status: string },
>(
  items: T[],
  stageId: string | null,
  droppedStage = false
): { atStage: T[]; elsewhere: T[] } {
  if (!stageId) return { atStage: items, elsewhere: [] };
  const atStage = items.filter((item) =>
    droppedStage
      ? item.status === 'dropped' || item.stage_id === stageId
      : item.stage_id === stageId && item.status !== 'dropped'
  );
  if (atStage.length === 0) return { atStage: items, elsewhere: [] };
  return {
    atStage,
    elsewhere: items.filter((item) => !atStage.includes(item)),
  };
}

export function focusBuckets<T extends { key: string }>(
  buckets: T[],
  focusedKey: string | null
): T[] {
  if (!focusedKey) return buckets;
  const focused = buckets.filter((bucket) => bucket.key === focusedKey);
  return focused.length ? focused : buckets;
}

export function withFocusedItem<T extends { id: string }>(
  atStage: T[],
  elsewhere: T[],
  focusItemId: string | null
): T[] {
  const focused = focusItemId
    ? elsewhere.find((item) => item.id === focusItemId)
    : undefined;
  return focused ? [...atStage, focused] : atStage;
}

export function journeyStageBucketKey(
  furthestStageIdx: number,
  stages: { id: string }[]
): string {
  const stage = furthestStageIdx >= 0 ? stages[furthestStageIdx] : undefined;
  return stage ? `stage:${stage.id}` : 'stage:unclassified';
}

export function splitJourneysByCompartment<T extends { subjectId: string }>(
  groups: T[],
  focusIds: ReadonlySet<string>
): { focus: T[]; passive: T[] } {
  const focus: T[] = [];
  const passive: T[] = [];
  for (const group of groups) {
    (focusIds.has(group.subjectId) ? focus : passive).push(group);
  }
  return { focus, passive };
}
