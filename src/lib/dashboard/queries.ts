import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  AgentLoadEntry,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// ------------------------------------------------------------
// The heavy aggregations — metric cards, conversations series,
// pipeline donut, response times — run as SQL functions (migrations
// 169 and 170) and name their account explicitly. They used to fetch
// raw rows and aggregate here, which meant the payload grew linearly
// with account activity.
//
// What is left client-side is deliberate: the activity feed merges
// five small per-table reads, and the response-time buckets key off
// the viewer's local day-of-week. Those still lean on RLS for
// scoping.
// ------------------------------------------------------------

type DB = SupabaseClient

/** IANA zone the charts bucket in. Falls back to UTC where the runtime
 *  doesn't report one. */
function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

// The account owner texting their own CRM WhatsApp number is not a lead;
// those self-chats are archived (webhook-handler + migration 154's
// backfill), so `conversations.is_archived = false` cleanly excludes them
// from every dashboard metric and the activity feed. Contacts carry no
// archive flag, so we exclude the owner's own contact by the contact_ids
// attached to archived conversations.
async function archivedContactIds(db: DB): Promise<string[]> {
  const { data } = await db.from('conversations').select('contact_id').eq('is_archived', true)
  const ids = new Set<string>()
  for (const r of (data ?? []) as { contact_id: string | null }[]) {
    if (r.contact_id) ids.add(r.contact_id)
  }
  return Array.from(ids)
}

// --- 1. Metric cards ---------------------------------------------------

interface DashboardMetricsRow {
  open_conversations: number
  new_conversations_today: number
  new_conversations_yesterday: number
  new_contacts_today: number
  new_contacts_yesterday: number
  open_deals_count: number
  open_deals_value: number
  messages_today: number
  messages_yesterday: number
}

export async function loadMetrics(db: DB, accountId: string): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const { data, error } = await db
    .rpc('dashboard_metrics', {
      p_account_id: accountId,
      p_today_start: todayStart,
      p_yesterday_start: yesterdayStart,
    })
    .maybeSingle<DashboardMetricsRow>()
  if (error) throw error

  return {
    activeConversations: {
      current: data?.open_conversations ?? 0,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: (data?.new_conversations_today ?? 0) - (data?.new_conversations_yesterday ?? 0),
    },
    newContactsToday: {
      current: data?.new_contacts_today ?? 0,
      previous: data?.new_contacts_yesterday ?? 0,
    },
    openDealsValue: Number(data?.open_deals_value ?? 0),
    openDealsCount: data?.open_deals_count ?? 0,
    messagesSentToday: {
      current: data?.messages_today ?? 0,
      previous: data?.messages_yesterday ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
  accountId: string,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()

  // The chart buckets by the viewer's local day, so the zone travels
  // with the query rather than the whole message set travelling back.
  const { data, error } = await db.rpc('dashboard_conversations_series', {
    p_account_id: accountId,
    p_start: start,
    p_time_zone: viewerTimeZone(),
  })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { day: string; incoming: number; outgoing: number }[]) {
    // `day` is already a local-day DATE from the function; keep the
    // seeded keys authoritative so empty days still render.
    if (!buckets.has(row.day)) continue
    buckets.set(row.day, { incoming: Number(row.incoming), outgoing: Number(row.outgoing) })
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(db: DB, accountId: string): Promise<PipelineDonutData> {
  // Empty stages are dropped by the function — the ring only ever
  // showed stages with deals on them.
  const { data, error } = await db.rpc('dashboard_pipeline_donut', {
    p_account_id: accountId,
  })
  if (error) throw error

  const slices: PipelineStageSlice[] = (
    (data ?? []) as {
      stage_id: string
      stage_name: string
      stage_color: string
      deal_count: number
      total_value: number
    }[]
  ).map((s) => ({
    id: s.stage_id,
    name: s.stage_name,
    color: s.stage_color,
    dealCount: Number(s.deal_count),
    totalValue: Number(s.total_value),
  }))

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: DB, accountId: string): Promise<ResponseTimeSummary> {
  // The pairing — each "first inbound" with the first outbound that
  // followed it, one sample per unreplied customer run — now happens in
  // the database, so only the pairs come back rather than 14 days of
  // messages. 14 days gives us both "this week" and "last week" with
  // enough overlap if the user opens the dashboard late on a Monday.
  //
  // Bucketing stays here: it keys off the viewer's local day-of-week.
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await db.rpc('dashboard_response_samples', {
    p_account_id: accountId,
    p_start: fourteenDaysAgo,
  })
  if (error) throw error

  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = (
    (data ?? []) as { customer_at: string; response_at: string }[]
  ).map((r) => ({
    customerAt: new Date(r.customer_at),
    responseAt: new Date(r.response_at),
  }))

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Org hierarchy: unassigned queue + per-agent load ---------------
//
// Leader/Manager-only (gated in the UI, not here — RLS is the real
// boundary: an Org Agent's `conversations` select only ever returns
// their own rows, so these would just report their own single-row
// "team" if called for an Agent). Deals/broadcasts/automation stay
// account-wide by design (see ORG_HIERARCHY_DESIGN.md's deferred
// scope) — only conversations/messages/contacts are team-isolated.

export async function loadUnassignedQueueDepth(db: DB): Promise<number> {
  const { count, error } = await db
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .eq('is_archived', false)
    .is('assigned_agent_id', null)
    .is('assigned_team_id', null)
  if (error) throw error
  return count ?? 0
}

export async function loadAgentLoad(db: DB): Promise<AgentLoadEntry[]> {
  const { data, error } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('status', 'open')
    .eq('is_archived', false)
    .not('assigned_agent_id', 'is', null)
  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { assigned_agent_id: string }[]) {
    counts.set(row.assigned_agent_id, (counts.get(row.assigned_agent_id) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const { data: profiles, error: profilesError } = await db
    .from('profiles')
    .select('user_id, full_name')
    .in('user_id', Array.from(counts.keys()))
  if (profilesError) throw profilesError

  return ((profiles ?? []) as { user_id: string; full_name: string | null }[])
    .map((p) => ({
      userId: p.user_id,
      fullName: p.full_name,
      openConversations: counts.get(p.user_id) ?? 0,
    }))
    .sort((a, b) => b.openConversations - a.openConversations)
}

// --- 6. Activity feed --------------------------------------------------

export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  const excludedContacts = new Set(await archivedContactIds(db))
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations!inner(contact_id, is_archived, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .eq('conversations.is_archived', false)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    if (excludedContacts.has(c.id)) continue
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
