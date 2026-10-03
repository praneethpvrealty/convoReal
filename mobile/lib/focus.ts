import { apiFetch } from '@/lib/api';
import { withAnalyticsTimeout } from '@/lib/analytics-request';

/**
 * Focus — the consultant's landing screen.
 *
 * Unlike lib/today.ts, none of this is computed here. The ranking that
 * decides the top three journeys and the top three requests lives in
 * src/lib/focus/rank.ts on the server and reaches both surfaces through
 * GET /api/focus, so the phone and the browser can never disagree about
 * what the agent should do next.
 */

export type FocusTaskKind = 'appointment' | 'todo';

export interface FocusSubjectRef {
  id: string;
  name: string;
  detail: string | null;
}

export interface FocusTask {
  id: string;
  kind: FocusTaskKind;
  title: string;
  at: string;
  overdue: boolean;
  location: string | null;
  priority: string | null;
  contact: FocusSubjectRef | null;
  property: FocusSubjectRef | null;
}

export interface FocusTasks {
  items: FocusTask[];
  visits: number;
  appointments: number;
  todos: number;
  overdue: number;
}

export interface FocusJourney {
  mode: 'buyer' | 'property';
  subjectId: string;
  subject: FocusSubjectRef;
  priority: 'high' | 'medium' | 'low' | null;
  furthestStageIdx: number;
  furthestStageName: string | null;
  lastUpdated: string;
  stalledDays: number;
  activeCount: number;
  reason: string;
}

export type FocusRequestKind =
  'inquiry' | 'match' | 'listing_submission' | 'bid';

export type FocusUrgency = 'now' | 'soon' | 'later';

export interface FocusRequest {
  id: string;
  kind: FocusRequestKind;
  title: string;
  detail: string | null;
  receivedAt: string;
  expiresAt: string | null;
  ageHours: number;
  urgency: FocusUrgency;
  score: number;
  href: string;
}

export type FocusDeadlineKind = 'milestone' | 'payment' | 'expected_close';
export type FocusDeadlineUrgency = 'overdue' | 'today' | 'soon';

/** Mirrored from src/lib/deals/deadlines.ts (DEAL_DEADLINE_URGENCY_LABELS). */
export const DEADLINE_URGENCY_LABELS: Record<FocusDeadlineUrgency, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  soon: 'Due soon',
};

/** Mirrored from src/lib/deals/deadlines.ts (DealDeadline). */
export interface FocusDeadline {
  dealId: string;
  kind: FocusDeadlineKind;
  milestoneId: string | null;
  title: string;
  subject: string;
  dueDate: string;
  daysLeft: number;
  urgency: FocusDeadlineUrgency;
  assignedTo: string | null;
  ownerUserId: string | null;
}

export interface FocusDeadlines {
  items: FocusDeadline[];
  total: number;
  overdue: number;
  dueToday: number;
  soon: number;
}

/** Mirrored from src/lib/deals/deadlines.ts (deadlineLabel). */
export function deadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = -daysLeft;
    return `Overdue by ${n} day${n === 1 ? '' : 's'}`;
  }
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

const DEADLINE_KIND_ORDER: Record<FocusDeadlineKind, number> = {
  milestone: 0,
  payment: 1,
  expected_close: 2,
};

/** Mirrored from src/lib/deals/deadlines.ts (sortDeadlines). */
export function sortDeadlines<
  T extends Pick<FocusDeadline, 'dueDate' | 'kind' | 'title'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      DEADLINE_KIND_ORDER[a.kind] - DEADLINE_KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title)
  );
}

/** Mirrored from src/lib/deals/deadlines.ts (DealDeadlineGroup). */
export interface FocusDeadlineGroup {
  dealId: string;
  subject: string;
  titles: string[];
  dueDate: string;
  daysLeft: number;
  urgency: FocusDeadlineUrgency;
  items: FocusDeadline[];
}

/** Mirrored from src/lib/deals/deadlines.ts (groupDeadlinesByDeal). */
export function groupDeadlinesByDeal(
  items: readonly FocusDeadline[]
): FocusDeadlineGroup[] {
  const groups = new Map<string, FocusDeadlineGroup>();
  for (const d of sortDeadlines(items)) {
    const group = groups.get(d.dealId);
    if (!group) {
      groups.set(d.dealId, {
        dealId: d.dealId,
        subject: d.subject,
        titles: [d.title],
        dueDate: d.dueDate,
        daysLeft: d.daysLeft,
        urgency: d.urgency,
        items: [d],
      });
      continue;
    }
    group.items.push(d);
    if (!group.titles.includes(d.title)) group.titles.push(d.title);
  }
  return [...groups.values()];
}

/** Mirrored from src/lib/deals/deadlines.ts (summarizeDeadlines). */
export function summarizeDeadlines(
  items: readonly Pick<FocusDeadline, 'urgency'>[]
): Omit<FocusDeadlines, 'items'> {
  return {
    total: items.length,
    overdue: items.filter((d) => d.urgency === 'overdue').length,
    dueToday: items.filter((d) => d.urgency === 'today').length,
    soon: items.filter((d) => d.urgency === 'soon').length,
  };
}

export const STALE_REQUEST_HOURS = 72;

export const REQUEST_URGENCY_LABELS: Record<FocusUrgency, string> = {
  now: 'Now',
  soon: 'Soon',
  later: 'When you can',
};

/** Mirrored from src/app/(dashboard)/dashboard/focus-content.tsx (isStale). */
export function isStaleRequest(
  request: Pick<FocusRequest, 'urgency' | 'ageHours'>
): boolean {
  return request.urgency !== 'now' && request.ageHours >= STALE_REQUEST_HOURS;
}

/** Mirrored from src/app/(dashboard)/dashboard/focus-content.tsx (requestBadge). */
export function requestBadge(
  request: Pick<FocusRequest, 'urgency' | 'ageHours'>
): { label: string; urgency: FocusUrgency } {
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

export function summarizeRequests(
  requests: readonly Pick<FocusRequest, 'urgency' | 'ageHours'>[]
): { now: number; stale: number; total: number; summary: string } {
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

export interface FocusSnapshot {
  tasks: FocusTasks;
  deadlines: FocusDeadlines;
  journeys: { top: FocusJourney[]; all: FocusJourney[] };
  requests: { top: FocusRequest[]; all: FocusRequest[] };
  generatedAt: string;
}

export async function fetchFocus(): Promise<FocusSnapshot> {
  return withAnalyticsTimeout(fetchFocusUnbounded(), 'Focus analytics');
}

async function fetchFocusUnbounded(): Promise<FocusSnapshot> {
  const { data } = await apiFetch<{ data: FocusSnapshot }>('/api/focus');
  return data;
}
