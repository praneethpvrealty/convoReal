import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay } from '@/lib/dashboard/date-utils'
import type { Contact, Conversation } from '@/types'

// ------------------------------------------------------------
// "Today" command-center loaders. Same pattern as
// src/lib/dashboard/queries.ts: all client-side aggregation over an
// RLS-scoped supabase client. RLS pins every query to the signed-in
// account, so the loaders take just the client. Perf is fine at the
// current scale (low thousands of messages / contacts) — if a tenant
// outgrows this we'd move the message walk into a SQL RPC.
// ------------------------------------------------------------

type DB = SupabaseClient

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** End of the local calendar day (23:59:59.999), mirroring
 *  startOfLocalDay from the dashboard date utils. */
function endOfLocalDay(d: Date = new Date()): Date {
  const out = startOfLocalDay(d)
  out.setDate(out.getDate() + 1)
  out.setMilliseconds(-1)
  return out
}

/** PostgREST can surface an embedded 1:1 relation as either an object
 *  or a single-element array depending on inferred cardinality —
 *  normalise to the object form (same trick as dashboard/queries.ts). */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// --- 1. Expiring WhatsApp sessions (+ awaiting-reply tail) -------------

export interface ExpiringSessionItem {
  conversation: Conversation
  contact: Contact | null
  /** Timestamp of the last inbound customer message (ISO). */
  lastCustomerAt: string
  /** When WhatsApp's 24-hour customer-service window closes (ISO). */
  expiresAt: string
}

/**
 * Conversations whose last message is from the customer with no agent
 * or bot reply after it, inside WhatsApp's 24-hour service window.
 * Sorted by window expiry, soonest first. The UI splits this one list:
 * expiring within 6h = "windows closing", older than 2h since the
 * customer wrote = "awaiting your reply", fresher than 2h = neither.
 */
export async function loadExpiringSessions(db: DB): Promise<ExpiringSessionItem[]> {
  const windowStart = new Date(Date.now() - DAY_MS).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', windowStart)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Walk per conversation (rows are grouped by conversation_id and
  // time-ordered within each group): remember the LAST customer
  // message and whether anything outbound landed after it.
  const unreplied = new Map<string, string>() // conversation_id -> lastCustomerAt
  let curConv = ''
  let lastCustomerAt: string | null = null
  let replied = false
  const flush = () => {
    if (curConv && lastCustomerAt && !replied) unreplied.set(curConv, lastCustomerAt)
  }
  for (const row of rows) {
    if (row.conversation_id !== curConv) {
      flush()
      curConv = row.conversation_id
      lastCustomerAt = null
      replied = false
    }
    if (row.sender_type === 'customer') {
      lastCustomerAt = row.created_at
      replied = false
    } else if (lastCustomerAt) {
      replied = true // agent + bot both close the "needs reply" state
    }
  }
  flush()

  if (unreplied.size === 0) return []

  const { data: convData, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .in('id', Array.from(unreplied.keys()))
  if (convError) throw convError

  type ConvRow = Omit<Conversation, 'contact'> & {
    contact: Contact | Contact[] | null
  }

  const items: ExpiringSessionItem[] = []
  for (const row of (convData ?? []) as unknown as ConvRow[]) {
    if (row.is_archived || row.status === 'closed') continue
    const customerAt = unreplied.get(row.id)
    if (!customerAt) continue
    const { contact: rawContact, ...conv } = row
    const contact = one(rawContact)
    items.push({
      conversation: { ...conv, contact: contact ?? undefined } as Conversation,
      contact,
      lastCustomerAt: customerAt,
      expiresAt: new Date(new Date(customerAt).getTime() + DAY_MS).toISOString(),
    })
  }

  return items.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}

// --- 2. Hot leads going quiet ------------------------------------------

export interface QuietHotLead {
  contact: Contact
  /** Whole days since last_contacted_at (or created_at when never
   *  contacted). */
  daysSilent: number
}

/**
 * Active HOT leads not touched in 48h+ (or never contacted at all),
 * longest-silent first. Capped at 20 — past that the agent should be
 * working the list, not scrolling it.
 */
export async function loadHotGoingQuiet(db: DB): Promise<QuietHotLead[]> {
  const { data, error } = await db
    .from('contacts')
    .select('*')
    .eq('status', 'active')
    .eq('lead_temp', 'HOT')
  if (error) throw error

  const cutoff = Date.now() - 48 * HOUR_MS
  const leads: QuietHotLead[] = []
  for (const contact of (data ?? []) as Contact[]) {
    const lastTouch = contact.last_contacted_at
      ? new Date(contact.last_contacted_at).getTime()
      : null
    if (lastTouch !== null && lastTouch > cutoff) continue
    const silentSince = lastTouch ?? new Date(contact.created_at).getTime()
    leads.push({
      contact,
      daysSilent: Math.max(0, Math.floor((Date.now() - silentSince) / DAY_MS)),
    })
  }

  return leads.sort((a, b) => b.daysSilent - a.daysSilent).slice(0, 20)
}

// --- 3. Today's agenda: appointments + open todos ----------------------

export interface AgendaContactRef {
  id: string
  name: string | null
  phone: string
}

export interface AgendaPropertyRef {
  id: string
  title: string
  location?: string | null
}

export interface AgendaAppointment {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  location: string | null
  status: string
  contact: AgendaContactRef | null
  property: AgendaPropertyRef | null
}

export interface AgendaTodo {
  id: string
  title: string
  due_date: string
  completed: boolean
  priority: string | null
  contact: AgendaContactRef | null
  property: AgendaPropertyRef | null
}

export interface TodaysAgenda {
  appointments: AgendaAppointment[]
  todos: AgendaTodo[]
}

/**
 * Everything scheduled for the local calendar day: appointments still
 * marked scheduled, plus incomplete todos due today — or earlier
 * (overdue items surface here too rather than silently ageing out).
 */
export async function loadTodaysAgenda(db: DB): Promise<TodaysAgenda> {
  const dayStart = startOfLocalDay().toISOString()
  const dayEnd = endOfLocalDay().toISOString()

  const [apptRes, todoRes] = await Promise.all([
    db
      .from('appointments')
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location)')
      .eq('status', 'scheduled')
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .order('start_time', { ascending: true }),
    db
      .from('todos')
      .select('*, contact:contacts(id, name, phone), property:properties(id, title)')
      .eq('completed', false)
      .not('due_date', 'is', null)
      .lte('due_date', dayEnd) // includes overdue from previous days
      .order('due_date', { ascending: true }),
  ])
  if (apptRes.error) throw apptRes.error
  if (todoRes.error) throw todoRes.error

  type ApptRow = Omit<AgendaAppointment, 'contact' | 'property'> & {
    contact: AgendaContactRef | AgendaContactRef[] | null
    property: AgendaPropertyRef | AgendaPropertyRef[] | null
  }
  type TodoRow = Omit<AgendaTodo, 'contact' | 'property'> & {
    contact: AgendaContactRef | AgendaContactRef[] | null
    property: AgendaPropertyRef | AgendaPropertyRef[] | null
  }

  const appointments: AgendaAppointment[] = (
    (apptRes.data ?? []) as unknown as ApptRow[]
  ).map((row) => ({
    ...row,
    contact: one(row.contact),
    property: one(row.property),
  }))

  const todos: AgendaTodo[] = ((todoRes.data ?? []) as unknown as TodoRow[]).map(
    (row) => ({
      ...row,
      contact: one(row.contact),
      property: one(row.property),
    }),
  )

  return { appointments, todos }
}
