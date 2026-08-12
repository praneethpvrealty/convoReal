import {
  JOURNEY_PRIORITY_META,
  priorityRank,
  type JourneyMode,
  type JourneyPriority,
} from '@/components/journey/shared'
import type { AgendaAppointment, AgendaTodo } from '@/lib/today/queries'
import type {
  FocusJourney,
  FocusRequest,
  FocusRequestKind,
  FocusSubjectRef,
  FocusTask,
  FocusTasks,
  FocusUrgency,
} from './types'

/**
 * The ranking behind Focus. Pure on purpose: it decides what "top 3"
 * means, and web and mobile both read the answer from GET /api/focus
 * rather than each deciding for themselves.
 */

/** How many of each list the gist cards show before you expand them. */
export const FOCUS_TOP_N = 3

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function wholeDaysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / DAY_MS))
}

function hoursSince(iso: string, nowMs: number): number {
  return Math.max(0, (nowMs - new Date(iso).getTime()) / HOUR_MS)
}

// --- 1. Tasks, to-dos and visits ---------------------------------------

/**
 * Collapse the day's appointments and open to-dos into one ordered
 * list. Overdue rows keep their place in time rather than being
 * hoisted — the card labels them instead, so the list still reads as a
 * day rather than a backlog.
 */
export function summarizeTasks(
  appointments: AgendaAppointment[],
  todos: AgendaTodo[],
  nowMs: number = Date.now(),
): FocusTasks {
  const dayStart = new Date(nowMs)
  dayStart.setHours(0, 0, 0, 0)
  const dayStartMs = dayStart.getTime()

  const items: FocusTask[] = [
    ...appointments.map<FocusTask>((a) => ({
      id: a.id,
      kind: 'appointment',
      title: a.title,
      at: a.start_time,
      overdue: new Date(a.end_time).getTime() < nowMs,
      location: a.location,
      priority: null,
      contact: a.contact
        ? { id: a.contact.id, name: a.contact.name || a.contact.phone, detail: a.contact.phone }
        : null,
      property: a.property
        ? { id: a.property.id, name: a.property.title, detail: a.property.location ?? null }
        : null,
    })),
    ...todos.map<FocusTask>((t) => ({
      id: t.id,
      kind: 'todo',
      title: t.title,
      at: t.due_date,
      overdue: new Date(t.due_date).getTime() < dayStartMs,
      location: null,
      priority: t.priority,
      contact: t.contact
        ? { id: t.contact.id, name: t.contact.name || t.contact.phone, detail: t.contact.phone }
        : null,
      property: t.property
        ? { id: t.property.id, name: t.property.title, detail: null }
        : null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return {
    items,
    visits: appointments.filter((a) => !!a.location?.trim()).length,
    appointments: appointments.length,
    todos: todos.length,
    overdue: items.filter((i) => i.overdue).length,
  }
}

// --- 2. Journeys --------------------------------------------------------

export interface JourneyCandidate {
  mode: JourneyMode
  subjectId: string
  subject: FocusSubjectRef
  priority: JourneyPriority | null
  furthestStageIdx: number
  furthestStageName: string | null
  lastUpdated: string
  activeCount: number
  /** journey_items making up this journey. Not sent to the client —
   *  selectTopJourneys uses it to keep the top three distinct. */
  itemIds: string[]
}

function journeyReason(j: FocusJourney): string {
  const parts: string[] = []
  if (j.priority) parts.push(`${JOURNEY_PRIORITY_META[j.priority].label} priority`)
  if (j.furthestStageName) parts.push(j.furthestStageName)
  parts.push(
    j.stalledDays === 0
      ? 'moved today'
      : `stalled ${j.stalledDays} day${j.stalledDays === 1 ? '' : 's'}`,
  )
  return parts.join(' · ')
}

/**
 * Order journeys by what deserves the next hour.
 *
 * Priority first, because a human already ranked those. Then furthest
 * stage, because a relationship one step from registration costs more
 * to lose than one that has only been sent a listing. Staleness breaks
 * the remaining ties — which is where this deliberately parts company
 * with the Journey overview's `sortJourneys(…, 'priority')`: that list
 * surfaces what moved most recently, Focus surfaces what has not moved.
 */
export function rankJourneys(
  candidates: JourneyCandidate[],
  nowMs: number = Date.now(),
): FocusJourney[] {
  return rankJourneyPairs(candidates, nowMs).map(([, journey]) => journey)
}

function rankJourneyPairs(
  candidates: JourneyCandidate[],
  nowMs: number,
): [JourneyCandidate, FocusJourney][] {
  return candidates
    .map<[JourneyCandidate, FocusJourney]>((candidate) => {
      // Built field by field rather than spread: itemIds is an input to
      // the ranking, not something the client should receive.
      const journey: FocusJourney = {
        mode: candidate.mode,
        subjectId: candidate.subjectId,
        subject: candidate.subject,
        priority: candidate.priority,
        furthestStageIdx: candidate.furthestStageIdx,
        furthestStageName: candidate.furthestStageName,
        lastUpdated: candidate.lastUpdated,
        activeCount: candidate.activeCount,
        stalledDays: wholeDaysSince(candidate.lastUpdated, nowMs),
        reason: '',
      }
      return [candidate, { ...journey, reason: journeyReason(journey) }]
    })
    .sort(([, a], [, b]) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
      if (byPriority !== 0) return byPriority
      const byStage = b.furthestStageIdx - a.furthestStageIdx
      if (byStage !== 0) return byStage
      const byStalled = b.stalledDays - a.stalledDays
      if (byStalled !== 0) return byStalled
      return a.subject.name.localeCompare(b.subject.name)
    })
}

/**
 * The journeys for the gist card — ranked, then thinned so no two show
 * the same work twice.
 *
 * Every journey_item belongs to two journeys at once: the buyer's and
 * the property's. Taking the top three off the ranked list alone would
 * happily spend two of them on "Ravi" and "Villa 12" when those are one
 * relationship seen from both ends. A journey is skipped when every one
 * of its items already appears in a journey above it; it still shows in
 * the expanded list, where the full ranking is the point.
 */
export function selectTopJourneys(
  candidates: JourneyCandidate[],
  n: number = FOCUS_TOP_N,
  nowMs: number = Date.now(),
): FocusJourney[] {
  const taken = new Set<string>()
  const picked: FocusJourney[] = []
  for (const [candidate, journey] of rankJourneyPairs(candidates, nowMs)) {
    if (picked.length >= n) break
    if (candidate.itemIds.length > 0 && candidate.itemIds.every((id) => taken.has(id))) {
      continue
    }
    candidate.itemIds.forEach((id) => taken.add(id))
    picked.push(journey)
  }
  return picked
}

// --- 3. Requests --------------------------------------------------------

export interface RequestCandidate {
  id: string
  kind: FocusRequestKind
  title: string
  detail: string | null
  receivedAt: string
  expiresAt: string | null
  href: string
}

/**
 * What each kind is worth before age and expiry are considered.
 *
 * A bid is a number on the table and outranks everything. A listing
 * submission is a seller who has already done the work of writing the
 * listing and is holding a code that dies in 24 hours. An inquiry is a
 * buyer who asked first. A Radar match is the engine's suggestion — a
 * real lead, but nobody is sitting on the other end waiting.
 */
const KIND_BASE: Record<FocusRequestKind, number> = {
  bid: 70,
  listing_submission: 60,
  inquiry: 55,
  match: 40,
}

/** Hours left before an expiring request stops being actionable. */
function hoursToExpiry(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) return null
  return (new Date(expiresAt).getTime() - nowMs) / HOUR_MS
}

/**
 * Score a request 0–100. Kind sets the floor, a near expiry adds the
 * most, and age adds a little — a request nobody answered gets louder
 * rather than quietly ageing out of the top three.
 */
export function scoreRequest(
  candidate: RequestCandidate,
  nowMs: number = Date.now(),
): number {
  let score = KIND_BASE[candidate.kind]

  const left = hoursToExpiry(candidate.expiresAt, nowMs)
  if (left !== null) {
    if (left <= 6) score += 30
    else if (left <= 24) score += 15
  }

  score += Math.min(20, hoursSince(candidate.receivedAt, nowMs) / 6)

  return Math.max(0, Math.min(100, Math.round(score)))
}

function urgencyOf(score: number, left: number | null): FocusUrgency {
  if (left !== null && left <= 6) return 'now'
  if (score >= 80) return 'now'
  if (score >= 55) return 'soon'
  return 'later'
}

/**
 * Score every inbound request and order them, highest first. Equal
 * scores go to whoever has been waiting longest — the fair tiebreak
 * when the engine has nothing else to separate them by.
 */
export function rankRequests(
  candidates: RequestCandidate[],
  nowMs: number = Date.now(),
): FocusRequest[] {
  return candidates
    .map<FocusRequest>((c) => {
      const score = scoreRequest(c, nowMs)
      return {
        ...c,
        score,
        ageHours: Math.floor(hoursSince(c.receivedAt, nowMs)),
        urgency: urgencyOf(score, hoursToExpiry(c.expiresAt, nowMs)),
      }
    })
    .sort((a, b) => {
      const byScore = b.score - a.score
      if (byScore !== 0) return byScore
      const byWait = a.receivedAt.localeCompare(b.receivedAt)
      if (byWait !== 0) return byWait
      return a.id.localeCompare(b.id)
    })
}
