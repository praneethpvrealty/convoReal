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

export function journeyRaceLabel(active: number): string {
  return active > 0 ? `${active} in the race` : 'Nothing in the race';
}

export function splitItemsAtStage<
  T extends { stage_id: string; status: string },
>(items: T[], stageId: string | null): { atStage: T[]; elsewhere: T[] } {
  if (!stageId) return { atStage: items, elsewhere: [] };
  const atStage = items.filter(
    (item) => item.stage_id === stageId && item.status !== 'dropped'
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
