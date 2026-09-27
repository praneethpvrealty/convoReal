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

export function journeyEnquiryLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 enquiry' : `${count} enquiries`;
}

export const JOURNEY_ENQUIRY_SELECT =
  'id, inquiry_source, inquiry_date, created_at, property:properties(id, title, property_code, location), contact:contacts(id, name, phone)';

export interface JourneyEnquiryRow {
  id: string;
  inquiry_source: string | null;
  inquiry_date: string | null;
  created_at: string | null;
  property: {
    id: string;
    title: string | null;
    property_code: string | null;
    location: string | null;
  } | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
}

export interface JourneyEnquiryEntry {
  id: string;
  targetId: string | null;
  title: string;
  subtitle: string;
  source: string | null;
  enquiredAt: string | null;
}

export function journeyEnquiryEntries(
  rows: JourneyEnquiryRow[],
  mode: 'buyer' | 'property'
): JourneyEnquiryEntry[] {
  return rows
    .map((row) => {
      const enquiredAt = row.inquiry_date ?? row.created_at;
      if (mode === 'buyer') {
        return {
          id: row.id,
          targetId: row.property?.id ?? null,
          title: row.property?.title || 'Unknown property',
          subtitle: [row.property?.property_code, row.property?.location]
            .filter(Boolean)
            .join(' · '),
          source: row.inquiry_source,
          enquiredAt,
        };
      }
      return {
        id: row.id,
        targetId: row.contact?.id ?? null,
        title: row.contact?.name || row.contact?.phone || 'Unknown contact',
        subtitle: row.contact?.name ? (row.contact.phone ?? '') : '',
        source: row.inquiry_source,
        enquiredAt,
      };
    })
    .sort((a, b) => (b.enquiredAt ?? '').localeCompare(a.enquiredAt ?? ''));
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
