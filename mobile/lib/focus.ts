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
  | 'inquiry'
  | 'match'
  | 'listing_submission'
  | 'bid';

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
