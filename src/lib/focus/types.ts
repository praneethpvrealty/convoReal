import type { JourneyMode, JourneyPriority } from '@/components/journey/shared'

/**
 * Focus — the consultant's landing view. Three questions, answered in
 * one screen: what am I doing today, which relationships need me, and
 * who is waiting on an answer.
 *
 * Every shape here crosses the wire from GET /api/focus to both the
 * web tab and the mobile screen, so the ranking that produced it can
 * never differ between the two surfaces.
 */

export type FocusTaskKind = 'appointment' | 'todo'

export interface FocusSubjectRef {
  id: string
  name: string
  detail: string | null
}

export interface FocusTask {
  id: string
  kind: FocusTaskKind
  title: string
  /** Appointment start, or todo due date. */
  at: string
  /** A todo due before today, or an appointment whose slot has passed. */
  overdue: boolean
  /** Appointments only — a task with a place is a site visit. */
  location: string | null
  priority: string | null
  contact: FocusSubjectRef | null
  property: FocusSubjectRef | null
}

export interface FocusTasks {
  /** Ordered by time; the gist card shows the head of this list. */
  items: FocusTask[]
  /** Appointments carrying a location — the day's site visits. */
  visits: number
  appointments: number
  todos: number
  overdue: number
}

export interface FocusJourney {
  mode: JourneyMode
  subjectId: string
  subject: FocusSubjectRef
  priority: JourneyPriority | null
  /** Position of the furthest stage any item reached, -1 when none. */
  furthestStageIdx: number
  furthestStageName: string | null
  /** Most recent item update across the journey. */
  lastUpdated: string
  /** Whole days since anything moved. */
  stalledDays: number
  /** Live (non-dropped, non-hidden) items in the journey. */
  activeCount: number
  /** Why this journey ranked where it did, in the agent's words. */
  reason: string
}

export type FocusRequestKind =
  | 'inquiry'
  | 'match'
  | 'listing_submission'
  | 'bid'

export type FocusUrgency = 'now' | 'soon' | 'later'

export interface FocusRequest {
  /** Unique across kinds — the source row id is only unique per table. */
  id: string
  kind: FocusRequestKind
  title: string
  detail: string | null
  /** When the request arrived. */
  receivedAt: string
  /** When it stops being actionable, for the kinds that expire. */
  expiresAt: string | null
  ageHours: number
  urgency: FocusUrgency
  /** 0–100, from rankRequests. Ordering key, and shown as a bar. */
  score: number
  /** Where acting on it happens. Relative; mobile maps it to a route. */
  href: string
}

export interface FocusSnapshot {
  tasks: FocusTasks
  journeys: {
    /** The three that most need attention. */
    top: FocusJourney[]
    /** Everything, for the expanded card. */
    all: FocusJourney[]
  }
  requests: {
    top: FocusRequest[]
    all: FocusRequest[]
  }
  generatedAt: string
}
