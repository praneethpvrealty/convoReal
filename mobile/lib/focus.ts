import { apiFetch } from '@/lib/api';

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

export interface FocusSnapshot {
  tasks: FocusTasks;
  journeys: { top: FocusJourney[]; all: FocusJourney[] };
  requests: { top: FocusRequest[]; all: FocusRequest[] };
  generatedAt: string;
}

export async function fetchFocus(): Promise<FocusSnapshot> {
  const { data } = await apiFetch<{ data: FocusSnapshot }>('/api/focus');
  return data;
}
