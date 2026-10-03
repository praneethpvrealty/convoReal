export type FocusUrgency = 'now' | 'soon' | 'later';

export interface FocusRequestAge {
  urgency: FocusUrgency;
  ageHours: number;
}

export const STALE_REQUEST_HOURS = 72;

export const REQUEST_URGENCY_LABELS: Record<FocusUrgency, string> = {
  now: 'Now',
  soon: 'Soon',
  later: 'When you can',
};

export function isStaleRequest(request: FocusRequestAge): boolean {
  return request.urgency !== 'now' && request.ageHours >= STALE_REQUEST_HOURS;
}

export function requestBadge(request: FocusRequestAge): {
  label: string;
  urgency: FocusUrgency;
} {
  if (isStaleRequest(request))
    return {
      label: `${Math.floor(request.ageHours / 24)} d`,
      urgency: 'later',
    };
  return {
    label: REQUEST_URGENCY_LABELS[request.urgency],
    urgency: request.urgency,
  };
}

export function summarizeRequests(requests: readonly FocusRequestAge[]): {
  now: number;
  stale: number;
  total: number;
  summary: string;
} {
  const now = requests.filter((r) => r.urgency === 'now').length;
  const stale = requests.filter(isStaleRequest).length;
  const summary = requests.length
    ? [
        `${now} needing an answer now`,
        `${requests.length} open in total`,
        ...(stale > 0 ? [`${stale} waiting over 3 days`] : []),
      ].join(' · ')
    : '';
  return { now, stale, total: requests.length, summary };
}
