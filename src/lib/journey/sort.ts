/**
 * The Journey overview's priority ladder, sort modes and drop reasons
 * (JRN-012, UIX-008), shared at runtime by web and mobile. The mobile
 * app bundles this file through `@shared/`, so it must stay free of
 * imports — mobile/metro.config.js refuses any that are not relative,
 * and src/lib/mobile-parity.test.ts checks the same from the web side.
 */

export type JourneyPriority = 'high' | 'medium' | 'low';

export const JOURNEY_PRIORITY_LABELS: Record<JourneyPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const JOURNEY_PRIORITY_RANKS: Record<JourneyPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const JOURNEY_PRIORITY_ORDER: JourneyPriority[] = [
  'high',
  'medium',
  'low',
];

export function isJourneyPriority(value: unknown): value is JourneyPriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

export type JourneySort =
  'enquiries' | 'enquired' | 'manual' | 'priority' | 'recent' | 'stage';

export const DEFAULT_JOURNEY_SORT: JourneySort = 'enquiries';

export const JOURNEY_SORT_LABELS: Record<JourneySort, string> = {
  enquiries: 'Most enquired',
  enquired: 'Recently enquired',
  manual: 'Manual order',
  priority: 'Priority',
  recent: 'Recent activity',
  stage: 'Furthest stage',
};

/** Unrated journeys fall to the bottom with rank 3. */
export function priorityRank(priority: JourneyPriority | null): number {
  return priority ? JOURNEY_PRIORITY_RANKS[priority] : 3;
}

export interface RankableJourney {
  priority: JourneyPriority | null;
  furthestStageIdx: number;
  lastUpdated: string;
  enquiryCount: number;
  lastEnquiredAt: string | null;
  sortOrder?: number;
}

/**
 * Order journeys for the overview list. Every mode breaks ties the
 * same way (priority → furthest stage → most recently touched) so the
 * numbered rank stays stable when only the leading key changes.
 */
export function sortJourneys<T extends RankableJourney>(
  journeys: T[],
  sort: JourneySort
): T[] {
  const byPriority = (a: T, b: T) =>
    priorityRank(a.priority) - priorityRank(b.priority);
  const byManual = (a: T, b: T) =>
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
    (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
  const byStage = (a: T, b: T) => b.furthestStageIdx - a.furthestStageIdx;
  const byRecent = (a: T, b: T) => b.lastUpdated.localeCompare(a.lastUpdated);
  const byEnquiries = (a: T, b: T) => b.enquiryCount - a.enquiryCount;
  const byEnquired = (a: T, b: T) =>
    (b.lastEnquiredAt ?? '').localeCompare(a.lastEnquiredAt ?? '');
  const chain: Record<JourneySort, ((a: T, b: T) => number)[]> = {
    enquiries: [byEnquiries, byEnquired, byRecent, byStage],
    enquired: [byEnquired, byEnquiries, byRecent, byStage],
    manual: [byManual, byPriority, byStage, byRecent],
    priority: [byPriority, byStage, byRecent],
    stage: [byStage, byPriority, byRecent],
    recent: [byRecent, byPriority, byStage],
  };
  return [...journeys].sort((a, b) => {
    for (const compare of chain[sort]) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  });
}

/** One-tap drop reasons — the free-text field stays available for
 *  anything not covered. */
export const QUICK_DROP_REASONS = [
  'Budget mismatch',
  'Location not suitable',
  "Didn't like the property",
  'Owner not negotiable',
  'Chose another property',
  'Legal issues',
  'Not responding',
];

export const JOURNEY_REASON_MAX_LENGTH = 500;
