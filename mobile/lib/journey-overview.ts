export const JOURNEY_LIFECYCLE_STATUSES = [
  'active',
  'completed',
  'paused',
  'not_proceeding',
] as const;

export type JourneyLifecycleStatus =
  (typeof JOURNEY_LIFECYCLE_STATUSES)[number];
export type ClosedJourneyStatus = Exclude<JourneyLifecycleStatus, 'active'>;

export const CLOSED_JOURNEY_STATUS_LABELS: Record<ClosedJourneyStatus, string> =
  {
    completed: 'Completed successfully',
    paused: 'Paused — may return',
    not_proceeding: 'Not proceeding',
  };

export const JOURNEY_CLOSURE_REASONS: Record<
  ClosedJourneyStatus,
  readonly string[]
> = {
  completed: ['Transaction completed', 'Brokerage received'],
  paused: [
    'Requirement on hold',
    'Budget or timing changed',
    'Waiting for a future opportunity',
  ],
  not_proceeding: [
    'Changed their mind',
    'Bought another property',
    'Location no longer suitable',
    'Budget mismatch',
    'Not responding',
  ],
};

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

export interface JourneySourceChip {
  source: string | null;
  label: string;
  clear?: boolean;
}

export function journeySourceChips(
  options: JourneyEnquirySourceOption[],
  selected: string | null
): JourneySourceChip[] {
  const chips = options.map((option) => ({
    source: option.source,
    label: `${option.source} ${option.count}`,
  }));
  const chosen = chips.find((chip) => chip.source === selected);
  return [
    ...(chosen ? [chosen] : []),
    ...(selected ? [{ source: null, label: 'Clear', clear: true }] : []),
    { source: null, label: 'All sources' },
    ...chips.filter((chip) => chip !== chosen),
  ];
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

export type JourneySort = 'enquiries' | 'enquired' | 'manual' | 'stage';

export const DEFAULT_JOURNEY_SORT: JourneySort = 'enquiries';

export const JOURNEY_SORT_LABELS: Record<JourneySort, string> = {
  enquiries: 'Most enquired',
  enquired: 'Recently enquired',
  manual: 'Manual order',
  stage: 'Furthest stage',
};

export interface RankableJourney {
  furthestStageIdx: number;
  lastUpdated: string;
  enquiryCount: number;
  lastEnquiredAt: string | null;
  sortOrder: number;
}

export function sortJourneys<T extends RankableJourney>(
  journeys: T[],
  sort: JourneySort
): T[] {
  const byManual = (a: T, b: T) => a.sortOrder - b.sortOrder;
  const byStage = (a: T, b: T) => b.furthestStageIdx - a.furthestStageIdx;
  const byRecent = (a: T, b: T) => b.lastUpdated.localeCompare(a.lastUpdated);
  const byEnquiries = (a: T, b: T) => b.enquiryCount - a.enquiryCount;
  const byEnquired = (a: T, b: T) =>
    (b.lastEnquiredAt ?? '').localeCompare(a.lastEnquiredAt ?? '');
  const chain: Record<JourneySort, ((a: T, b: T) => number)[]> = {
    enquiries: [byEnquiries, byEnquired, byRecent, byStage],
    enquired: [byEnquired, byEnquiries, byRecent, byStage],
    manual: [byManual, byStage, byRecent],
    stage: [byStage, byRecent],
  };
  return [...journeys].sort((a, b) => {
    for (const compare of chain[sort]) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  });
}
