import type { SupabaseClient } from '@supabase/supabase-js'
import { stageIndexOf, type JourneyMode, type JourneyPriority } from '@/components/journey/shared'
import { loadTodaysAgenda } from '@/lib/today/queries'
import type { JourneyItem, JourneyStage } from '@/types'
import {
  FOCUS_TOP_N,
  rankJourneys,
  rankRequests,
  selectTopJourneys,
  summarizeTasks,
  type JourneyCandidate,
  type RequestCandidate,
} from './rank'
import type { FocusSnapshot } from './types'

/**
 * Loaders behind GET /api/focus. They expect an RLS-scoped client —
 * `loadTodaysAgenda` is shared with the Today page and leans on RLS for
 * its account scoping, so a service-role client would read every
 * tenant's agenda.
 */

type DB = SupabaseClient

const DAY_MS = 86_400_000

/** How far back an unanswered inquiry still counts as actionable. */
const INQUIRY_LOOKBACK_DAYS = 14

/** Journeys are grouped in memory, same as the Journey overview. */
const JOURNEY_ITEM_LIMIT = 2000

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// --- Journeys -----------------------------------------------------------

interface JourneyRow extends Omit<JourneyItem, 'contact' | 'property'> {
  contact: { id: string; name: string | null; phone: string | null } | null
  property: { id: string; title: string; property_code: string | null } | null
}

/**
 * Group journey_items by subject into rankable journeys, both
 * directions at once — a consultant's attention is not split by mode,
 * so Focus ranks buyer and property journeys in one list.
 */
export async function loadJourneyCandidates(
  db: DB,
  accountId: string,
): Promise<JourneyCandidate[]> {
  const [itemsRes, stagesRes, prioritiesRes] = await Promise.all([
    db
      .from('journey_items')
      .select(
        'id, contact_id, property_id, stage_id, status, hidden, updated_at, contact:contacts(id, name, phone), property:properties(id, title, property_code)',
      )
      .eq('account_id', accountId)
      .eq('status', 'active')
      .eq('hidden', false)
      .order('updated_at', { ascending: false })
      .limit(JOURNEY_ITEM_LIMIT),
    db
      .from('journey_stages')
      .select('*')
      .eq('account_id', accountId)
      .order('position'),
    db
      .from('journey_priorities')
      .select('mode, subject_id, priority')
      .eq('account_id', accountId),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (stagesRes.error) throw stagesRes.error
  if (prioritiesRes.error) throw prioritiesRes.error

  const stages = (stagesRes.data ?? []) as JourneyStage[]
  const priorities = new Map<string, JourneyPriority>(
    (
      (prioritiesRes.data ?? []) as {
        mode: JourneyMode
        subject_id: string
        priority: JourneyPriority
      }[]
    ).map((r) => [`${r.mode}:${r.subject_id}`, r.priority]),
  )

  const byKey = new Map<string, JourneyCandidate>()
  for (const raw of (itemsRes.data ?? []) as unknown as JourneyRow[]) {
    const contact = one(raw.contact)
    const property = one(raw.property)
    const subjects: { mode: JourneyMode; id: string; name: string; detail: string | null }[] = [
      {
        mode: 'buyer',
        id: raw.contact_id,
        name: contact?.name || contact?.phone || 'Unknown contact',
        detail: contact?.phone ?? null,
      },
      {
        mode: 'property',
        id: raw.property_id,
        name: property?.title || 'Untitled property',
        detail: property?.property_code ?? null,
      },
    ]

    for (const subject of subjects) {
      const key = `${subject.mode}:${subject.id}`
      let candidate = byKey.get(key)
      if (!candidate) {
        candidate = {
          mode: subject.mode,
          subjectId: subject.id,
          subject: { id: subject.id, name: subject.name, detail: subject.detail },
          priority: priorities.get(key) ?? null,
          furthestStageIdx: -1,
          furthestStageName: null,
          lastUpdated: raw.updated_at,
          activeCount: 0,
          itemIds: [],
        }
        byKey.set(key, candidate)
      }
      candidate.activeCount += 1
      candidate.itemIds.push(raw.id)
      const idx = stageIndexOf(raw as JourneyItem, stages)
      if (idx > candidate.furthestStageIdx) {
        candidate.furthestStageIdx = idx
        candidate.furthestStageName = stages[idx]?.name ?? null
      }
      if (raw.updated_at > candidate.lastUpdated) candidate.lastUpdated = raw.updated_at
    }
  }

  return Array.from(byKey.values())
}

// --- Requests -----------------------------------------------------------

interface InquiryRow {
  contact_id: string
  property_id: string
  inquiry_source: string | null
  inquiry_date: string | null
  created_at: string
  contact: { id: string; name: string | null; phone: string | null; last_contacted_at: string | null } | null
  property: { id: string; title: string; property_code: string | null } | null
}

/**
 * Property inquiries nobody has answered — a portal or website lead
 * whose contact has not been touched since they asked. A contact
 * contacted after the inquiry landed is, by definition, handled.
 */
async function loadInquiryRequests(db: DB, accountId: string): Promise<RequestCandidate[]> {
  const since = new Date(Date.now() - INQUIRY_LOOKBACK_DAYS * DAY_MS).toISOString()
  const { data, error } = await db
    .from('contact_property_inquiries')
    .select(
      'contact_id, property_id, inquiry_source, inquiry_date, created_at, contact:contacts(id, name, phone, last_contacted_at), property:properties(id, title, property_code)',
    )
    .eq('account_id', accountId)
    .gte('inquiry_date', since)
    .order('inquiry_date', { ascending: false })
  if (error) throw error

  const out: RequestCandidate[] = []
  for (const raw of (data ?? []) as unknown as InquiryRow[]) {
    const contact = one(raw.contact)
    const property = one(raw.property)
    const receivedAt = raw.inquiry_date ?? raw.created_at
    if (!contact || !receivedAt) continue
    if (contact.last_contacted_at && contact.last_contacted_at >= receivedAt) continue

    out.push({
      id: `inquiry:${raw.contact_id}:${raw.property_id}`,
      kind: 'inquiry',
      title: `${contact.name || contact.phone || 'A lead'} asked about ${property?.title ?? 'a listing'}`,
      detail: [raw.inquiry_source, property?.property_code].filter(Boolean).join(' · ') || null,
      receivedAt,
      expiresAt: null,
      href: `/contacts?contactId=${raw.contact_id}`,
    })
  }
  return out
}

interface MatchEventRow {
  id: string
  kind: 'new_property' | 'buyer_updated'
  matches: { id: string; name: string }[] | null
  created_at: string
  property: { id: string; title: string } | null
  contact: { id: string; name: string | null; phone: string | null } | null
}

/** Unresolved Match Radar events — the engine's suggestions. */
async function loadMatchRequests(db: DB, accountId: string): Promise<RequestCandidate[]> {
  const { data, error } = await db
    .from('match_events')
    .select('id, kind, matches, created_at, property:properties(id, title), contact:contacts(id, name, phone)')
    .eq('account_id', accountId)
    .eq('status', 'new')
    .order('created_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as MatchEventRow[]).map((raw) => {
    const property = one(raw.property)
    const contact = one(raw.contact)
    const count = raw.matches?.length ?? 0
    const subject =
      raw.kind === 'new_property'
        ? (property?.title ?? 'A new listing')
        : (contact?.name || contact?.phone || 'A buyer')
    return {
      id: `match:${raw.id}`,
      kind: 'match' as const,
      title:
        raw.kind === 'new_property'
          ? `${subject} matches ${count} buyer${count === 1 ? '' : 's'}`
          : `${subject} now matches ${count} listing${count === 1 ? '' : 's'}`,
      detail: null,
      receivedAt: raw.created_at,
      expiresAt: null,
      href: '/dashboard?tab=radar',
    }
  })
}

interface SubmissionRow {
  id: string
  code: string
  submitter_name: string | null
  raw_text: string
  created_at: string
  expires_at: string
}

/**
 * Sellers who submitted a listing and are holding a verification code
 * that dies in 24 hours. Expired rows are already dead — skip them
 * rather than rank something nobody can act on.
 */
async function loadSubmissionRequests(db: DB, accountId: string): Promise<RequestCandidate[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await db
    .from('public_listing_submissions')
    .select('id, code, submitter_name, raw_text, created_at, expires_at')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: true })
  if (error) throw error

  return ((data ?? []) as SubmissionRow[]).map((raw) => ({
    id: `submission:${raw.id}`,
    kind: 'listing_submission' as const,
    title: `${raw.submitter_name || 'A seller'} submitted a listing (${raw.code})`,
    detail: raw.raw_text.trim().slice(0, 120) || null,
    receivedAt: raw.created_at,
    expiresAt: raw.expires_at,
    href: '/inventory',
  }))
}

interface BidRow {
  id: string
  amount: number
  bid_type: string
  message: string | null
  created_at: string
  expires_at: string | null
  property: { id: string; title: string } | null
}

/** Live offers on this account's inventory, awaiting an answer. */
async function loadBidRequests(db: DB, accountId: string): Promise<RequestCandidate[]> {
  const { data, error } = await db
    .from('property_bids')
    .select('id, amount, bid_type, message, created_at, expires_at, property:properties(id, title)')
    .eq('owner_account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as BidRow[]).map((raw) => {
    const property = one(raw.property)
    return {
      id: `bid:${raw.id}`,
      kind: 'bid' as const,
      title: `Offer on ${property?.title ?? 'a listing'}`,
      detail: raw.message?.trim() || `${raw.bid_type === 'rent' ? 'Rent' : 'Sale'} bid`,
      receivedAt: raw.created_at,
      expiresAt: raw.expires_at,
      href: property ? `/inventory?propertyId=${property.id}` : '/inventory',
    }
  })
}

/**
 * Every inbound request in one ranked list. A source that fails is
 * logged and skipped rather than blanking the whole screen — a broken
 * Radar table should not cost the agent their bids.
 */
export async function loadRequestCandidates(
  db: DB,
  accountId: string,
): Promise<RequestCandidate[]> {
  const loaders: [string, Promise<RequestCandidate[]>][] = [
    ['inquiries', loadInquiryRequests(db, accountId)],
    ['matches', loadMatchRequests(db, accountId)],
    ['submissions', loadSubmissionRequests(db, accountId)],
    ['bids', loadBidRequests(db, accountId)],
  ]
  const settled = await Promise.allSettled(loaders.map(([, p]) => p))

  const out: RequestCandidate[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') out.push(...result.value)
    else console.error(`[focus] ${loaders[i][0]} request loader failed:`, result.reason)
  })
  return out
}

// --- Snapshot -----------------------------------------------------------

/** Everything the Focus screen renders, ranked and ready. */
export async function loadFocusSnapshot(db: DB, accountId: string): Promise<FocusSnapshot> {
  const nowMs = Date.now()
  const [agenda, journeyCandidates, requestCandidates] = await Promise.all([
    loadTodaysAgenda(db),
    loadJourneyCandidates(db, accountId),
    loadRequestCandidates(db, accountId),
  ])

  const requests = rankRequests(requestCandidates, nowMs)

  return {
    tasks: summarizeTasks(agenda.appointments, agenda.todos, nowMs),
    journeys: {
      top: selectTopJourneys(journeyCandidates, FOCUS_TOP_N, nowMs),
      all: rankJourneys(journeyCandidates, nowMs),
    },
    requests: { top: requests.slice(0, FOCUS_TOP_N), all: requests },
    generatedAt: new Date(nowMs).toISOString(),
  }
}
