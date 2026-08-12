import { describe, expect, it } from 'vitest'
import type { AgendaAppointment, AgendaTodo } from '@/lib/today/queries'
import {
  FOCUS_TOP_N,
  rankJourneys,
  rankRequests,
  scoreRequest,
  selectTopJourneys,
  summarizeTasks,
  type JourneyCandidate,
  type RequestCandidate,
} from './rank'

const NOW = new Date('2026-08-12T12:00:00.000Z').getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString()
}

function appointment(over: Partial<AgendaAppointment> = {}): AgendaAppointment {
  return {
    id: 'a1',
    title: 'Site visit',
    description: null,
    start_time: iso(2 * HOUR),
    end_time: iso(3 * HOUR),
    location: 'Gachibowli',
    status: 'scheduled',
    contact: null,
    property: null,
    ...over,
  }
}

function todo(over: Partial<AgendaTodo> = {}): AgendaTodo {
  return {
    id: 't1',
    title: 'Call the owner',
    due_date: iso(4 * HOUR),
    completed: false,
    priority: 'high',
    contact: null,
    property: null,
    ...over,
  }
}

function journey(over: Partial<JourneyCandidate> = {}): JourneyCandidate {
  return {
    mode: 'buyer',
    subjectId: 'c1',
    subject: { id: 'c1', name: 'Ravi', detail: '919000000001' },
    priority: null,
    furthestStageIdx: 0,
    furthestStageName: 'Shared',
    lastUpdated: iso(-DAY),
    activeCount: 1,
    itemIds: ['i1'],
    ...over,
  }
}

function request(over: Partial<RequestCandidate> = {}): RequestCandidate {
  return {
    id: 'r1',
    kind: 'inquiry',
    title: 'A lead asked about Villa 12',
    detail: null,
    receivedAt: iso(-2 * HOUR),
    expiresAt: null,
    href: '/contacts',
    ...over,
  }
}

describe('summarizeTasks', () => {
  it('merges appointments and to-dos into one time-ordered list', () => {
    const result = summarizeTasks(
      [appointment({ id: 'a1', start_time: iso(5 * HOUR), end_time: iso(6 * HOUR) })],
      [todo({ id: 't1', due_date: iso(1 * HOUR) })],
      NOW,
    )
    expect(result.items.map((i) => i.id)).toEqual(['t1', 'a1'])
    expect(result.appointments).toBe(1)
    expect(result.todos).toBe(1)
  })

  it('counts only located appointments as visits', () => {
    const result = summarizeTasks(
      [
        appointment({ id: 'a1', location: 'Kondapur' }),
        appointment({ id: 'a2', location: null }),
        appointment({ id: 'a3', location: '   ' }),
      ],
      [],
      NOW,
    )
    expect(result.visits).toBe(1)
  })

  it('marks a to-do due before today overdue, but not one due later today', () => {
    const result = summarizeTasks(
      [],
      [
        todo({ id: 'yesterday', due_date: iso(-DAY) }),
        todo({ id: 'later-today', due_date: iso(6 * HOUR) }),
      ],
      NOW,
    )
    const overdue = result.items.filter((i) => i.overdue).map((i) => i.id)
    expect(overdue).toEqual(['yesterday'])
    expect(result.overdue).toBe(1)
  })

  it('marks an appointment overdue once its slot has passed', () => {
    const result = summarizeTasks(
      [appointment({ start_time: iso(-3 * HOUR), end_time: iso(-2 * HOUR) })],
      [],
      NOW,
    )
    expect(result.items[0].overdue).toBe(true)
  })
})

describe('rankJourneys', () => {
  it('puts a human-set priority above everything else', () => {
    const ranked = rankJourneys(
      [
        journey({ subjectId: 'far', subject: { id: 'far', name: 'Far', detail: null }, furthestStageIdx: 6 }),
        journey({ subjectId: 'urgent', subject: { id: 'urgent', name: 'Urgent', detail: null }, priority: 'high', furthestStageIdx: 0 }),
      ],
      NOW,
    )
    expect(ranked.map((j) => j.subjectId)).toEqual(['urgent', 'far'])
  })

  it('breaks a priority tie on furthest stage, then on staleness', () => {
    const ranked = rankJourneys(
      [
        journey({ subjectId: 'fresh-deep', subject: { id: 'fresh-deep', name: 'A', detail: null }, furthestStageIdx: 4, lastUpdated: iso(-DAY) }),
        journey({ subjectId: 'stale-deep', subject: { id: 'stale-deep', name: 'B', detail: null }, furthestStageIdx: 4, lastUpdated: iso(-9 * DAY) }),
        journey({ subjectId: 'stale-shallow', subject: { id: 'stale-shallow', name: 'C', detail: null }, furthestStageIdx: 1, lastUpdated: iso(-30 * DAY) }),
      ],
      NOW,
    )
    expect(ranked.map((j) => j.subjectId)).toEqual(['stale-deep', 'fresh-deep', 'stale-shallow'])
  })

  it('reports staleness in whole days and explains the ranking', () => {
    const [ranked] = rankJourneys(
      [journey({ priority: 'high', furthestStageName: 'Visited', lastUpdated: iso(-3 * DAY - HOUR) })],
      NOW,
    )
    expect(ranked.stalledDays).toBe(3)
    expect(ranked.reason).toBe('High priority · Visited · stalled 3 days')
  })

  it('says "moved today" rather than "stalled 0 days"', () => {
    const [ranked] = rankJourneys([journey({ lastUpdated: iso(-HOUR), furthestStageName: null })], NOW)
    expect(ranked.reason).toBe('moved today')
  })
})

describe('selectTopJourneys', () => {
  it('does not spend two slots on the same items seen from both ends', () => {
    const shared = ['i1', 'i2']
    const top = selectTopJourneys(
      [
        journey({ mode: 'buyer', subjectId: 'ravi', subject: { id: 'ravi', name: 'Ravi', detail: null }, priority: 'high', itemIds: shared }),
        journey({ mode: 'property', subjectId: 'villa', subject: { id: 'villa', name: 'Villa 12', detail: null }, priority: 'medium', itemIds: shared }),
        journey({ mode: 'buyer', subjectId: 'meera', subject: { id: 'meera', name: 'Meera', detail: null }, priority: 'low', itemIds: ['i9'] }),
      ],
      FOCUS_TOP_N,
      NOW,
    )
    expect(top.map((j) => j.subjectId)).toEqual(['ravi', 'meera'])
  })

  it('keeps a journey that only partly overlaps one already picked', () => {
    const top = selectTopJourneys(
      [
        journey({ subjectId: 'first', subject: { id: 'first', name: 'First', detail: null }, priority: 'high', itemIds: ['i1'] }),
        journey({ subjectId: 'second', subject: { id: 'second', name: 'Second', detail: null }, priority: 'medium', itemIds: ['i1', 'i2'] }),
      ],
      FOCUS_TOP_N,
      NOW,
    )
    expect(top.map((j) => j.subjectId)).toEqual(['first', 'second'])
  })

  it('never returns more than it was asked for', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      journey({ subjectId: `j${i}`, subject: { id: `j${i}`, name: `J${i}`, detail: null }, itemIds: [`i${i}`] }),
    )
    expect(selectTopJourneys(many, FOCUS_TOP_N, NOW)).toHaveLength(FOCUS_TOP_N)
  })
})

describe('scoreRequest', () => {
  it('ranks a bid above a match of the same age', () => {
    const at = iso(-1 * HOUR)
    expect(scoreRequest(request({ kind: 'bid', receivedAt: at }), NOW)).toBeGreaterThan(
      scoreRequest(request({ kind: 'match', receivedAt: at }), NOW),
    )
  })

  it('adds the most for an expiry inside six hours', () => {
    const base = request({ kind: 'listing_submission', receivedAt: iso(-HOUR) })
    const soon = scoreRequest({ ...base, expiresAt: iso(3 * HOUR) }, NOW)
    const later = scoreRequest({ ...base, expiresAt: iso(20 * HOUR) }, NOW)
    const never = scoreRequest({ ...base, expiresAt: null }, NOW)
    expect(soon).toBeGreaterThan(later)
    expect(later).toBeGreaterThan(never)
  })

  it('gets louder the longer it goes unanswered, up to a ceiling', () => {
    const fresh = scoreRequest(request({ receivedAt: iso(-HOUR) }), NOW)
    const old = scoreRequest(request({ receivedAt: iso(-3 * DAY) }), NOW)
    expect(old).toBeGreaterThan(fresh)

    // The age bonus tops out at +20, five days in — past that a
    // forgotten request stops climbing rather than crowding out
    // everything a bid or an expiring code could ever score.
    const capped = scoreRequest(request({ receivedAt: iso(-5 * DAY) }), NOW)
    const ancient = scoreRequest(request({ receivedAt: iso(-90 * DAY) }), NOW)
    expect(ancient).toBe(capped)
    expect(capped).toBeGreaterThan(old)
  })

  it('stays within 0–100', () => {
    const score = scoreRequest(
      request({ kind: 'bid', receivedAt: iso(-90 * DAY), expiresAt: iso(HOUR) }),
      NOW,
    )
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('rankRequests', () => {
  it('orders by score, and gives an exact tie to whoever waited longest', () => {
    const ranked = rankRequests(
      [
        request({ id: 'newer', receivedAt: iso(-2 * HOUR) }),
        request({ id: 'older', receivedAt: iso(-2 * HOUR - 1000) }),
      ],
      NOW,
    )
    expect(ranked.map((r) => r.id)).toEqual(['older', 'newer'])
  })

  it('calls anything expiring within six hours urgent, whatever its kind', () => {
    const [ranked] = rankRequests(
      [request({ kind: 'match', receivedAt: iso(-HOUR), expiresAt: iso(2 * HOUR) })],
      NOW,
    )
    expect(ranked.urgency).toBe('now')
  })

  it('leaves a fresh Radar match at the bottom of the ladder', () => {
    const [ranked] = rankRequests([request({ kind: 'match', receivedAt: iso(-HOUR) })], NOW)
    expect(ranked.urgency).toBe('later')
  })

  it('reports age in whole hours', () => {
    const [ranked] = rankRequests([request({ receivedAt: iso(-5 * HOUR - 1000) })], NOW)
    expect(ranked.ageHours).toBe(5)
  })
})
