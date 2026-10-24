export type JourneyLeadInterest = 'interested' | 'shortlisted';

export const JOURNEY_LEAD_INTEREST_LABELS: Record<JourneyLeadInterest, string> =
  {
    interested: 'Said interested',
    shortlisted: 'Shortlisted',
  };

export interface LeadInterestFields {
  lead_interest?: JourneyLeadInterest | null;
  lead_interest_at?: string | null;
}

export function journeyLeadInterestLabel(
  item: LeadInterestFields
): string | null {
  return item.lead_interest
    ? JOURNEY_LEAD_INTEREST_LABELS[item.lead_interest]
    : null;
}

export function mergeJourneyLeadInterest(
  current: JourneyLeadInterest | null | undefined,
  next: JourneyLeadInterest
): JourneyLeadInterest {
  return current === 'interested' ? 'interested' : next;
}

const RANK: Record<JourneyLeadInterest, number> = {
  interested: 0,
  shortlisted: 1,
};

function timeOf(value: string | null | undefined): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function sortCapturedByLeadInterest<T extends LeadInterestFields>(
  items: readonly T[]
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = a.item.lead_interest ? RANK[a.item.lead_interest] : 2;
      const rb = b.item.lead_interest ? RANK[b.item.lead_interest] : 2;
      if (ra !== rb) return ra - rb;
      if (ra < 2) {
        const dt =
          timeOf(b.item.lead_interest_at) - timeOf(a.item.lead_interest_at);
        if (dt !== 0) return dt;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function journeyLeadInterestCountLabel(count: number): string | null {
  if (!count || count < 1) return null;
  return `${count} interested`;
}
