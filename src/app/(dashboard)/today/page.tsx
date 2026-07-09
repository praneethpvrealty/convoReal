"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarDays,
  Check,
  Clock,
  Flame,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Smartphone,
  Timer,
} from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  loadExpiringSessions,
  loadHotGoingQuiet,
  loadTodaysAgenda,
  type AgendaAppointment,
  type AgendaTodo,
  type ExpiringSessionItem,
  type QuietHotLead,
  type TodaysAgenda,
} from '@/lib/today/queries'
import type { Contact } from '@/types'

const HOUR_MS = 3_600_000

type SectionFilter = 'all' | 'windows' | 'hot' | 'replies' | 'agenda'

const FILTER_CHIPS: { key: SectionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'windows', label: 'Windows' },
  { key: 'hot', label: 'Hot leads' },
  { key: 'replies', label: 'Replies' },
  { key: 'agenda', label: 'Agenda' },
]

// ------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------

function formatBudget(val: number) {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
  if (val >= 100000) return `₹${(val / 100000).toFixed(2).replace(/\.00$/, '')} L`
  return `₹${val.toLocaleString('en-IN')}`
}

function countdownLabel(expiresAt: string, nowMs: number) {
  const diff = new Date(expiresAt).getTime() - nowMs
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / HOUR_MS)
  const m = Math.floor((diff % HOUR_MS) / 60_000)
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

function agoLabel(at: string, nowMs: number) {
  const diff = Math.max(0, nowMs - new Date(at).getTime())
  const h = Math.floor(diff / HOUR_MS)
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function silentLabel(days: number) {
  if (days <= 0) return 'quiet today'
  return days === 1 ? '1 day silent' : `${days} days silent`
}

function timeChip(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function refreshedLabel(refreshedAtMs: number, nowMs: number) {
  const mins = Math.floor((nowMs - refreshedAtMs) / 60_000)
  if (mins < 1) return 'Refreshed just now'
  return `Refreshed ${mins}m ago`
}

function classificationBadge(c: Contact | null) {
  if (!c?.classification) return null
  const cls =
    c.classification === 'Buyer'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : c.classification === 'Agent'
        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
        : 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold ${cls}`}>
      {c.classification}
    </span>
  )
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function TodayPage() {
  const router = useRouter()
  const { user, accountId } = useAuth()

  const [expiring, setExpiring] = useState<ExpiringSessionItem[] | null>(null)
  const [expiringLoading, setExpiringLoading] = useState(true)

  const [hotLeads, setHotLeads] = useState<QuietHotLead[] | null>(null)
  const [hotLoading, setHotLoading] = useState(true)

  const [agenda, setAgenda] = useState<TodaysAgenda | null>(null)
  const [agendaLoading, setAgendaLoading] = useState(true)

  const [filter, setFilter] = useState<SectionFilter>('all')
  /** Agenda rows mid-way through their optimistic strikethrough. */
  const [completing, setCompleting] = useState<Set<string>>(new Set())

  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())
  // 30s tick drives the countdown chips and the "Refreshed Xm ago"
  // label without re-fetching anything.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const loadAll = useCallback(() => {
    const db = createClient()
    setExpiringLoading(true)
    setHotLoading(true)
    setAgendaLoading(true)

    // Fire everything in parallel; each section owns its skeleton so a
    // slow loader never blocks the others (same as the dashboard page).
    void loadExpiringSessions(db)
      .then((items) => setExpiring(items))
      .catch((err) => console.error('[today] expiring sessions failed:', err))
      .finally(() => setExpiringLoading(false))

    void loadHotGoingQuiet(db)
      .then((leads) => setHotLeads(leads))
      .catch((err) => console.error('[today] hot leads failed:', err))
      .finally(() => setHotLoading(false))

    void loadTodaysAgenda(db)
      .then((a) => setAgenda(a))
      .catch((err) => console.error('[today] agenda failed:', err))
      .finally(() => setAgendaLoading(false))

    setRefreshedAt(Date.now())
    setNow(Date.now())
  }, [])

  useEffect(() => {
    // Microtask defer keeps the synchronous loading-flag setters out of
    // the effect body (react-hooks/set-state-in-effect) — same pattern
    // as the pipelines page's fetchCurrency effect.
    if (accountId) Promise.resolve().then(() => loadAll())
  }, [accountId, loadAll])

  // --- Split loader 1's list into the two visible sections ------------
  const { windowsClosing, awaitingReply } = useMemo(() => {
    const closing: ExpiringSessionItem[] = []
    const awaiting: ExpiringSessionItem[] = []
    for (const item of expiring ?? []) {
      const expiresIn = new Date(item.expiresAt).getTime() - now
      if (expiresIn <= 6 * HOUR_MS) {
        closing.push(item)
      } else if (now - new Date(item.lastCustomerAt).getTime() > 2 * HOUR_MS) {
        awaiting.push(item) // recent (<2h) chats are excluded entirely
      }
    }
    return { windowsClosing: closing, awaitingReply: awaiting }
  }, [expiring, now])

  const agendaCount = (agenda?.appointments.length ?? 0) + (agenda?.todos.length ?? 0)

  // --- Row actions ------------------------------------------------------

  const handleHandled = (conversationId: string) => {
    setExpiring((prev) =>
      prev ? prev.filter((i) => i.conversation.id !== conversationId) : prev,
    )
  }

  const handleMarkContacted = async (contact: Contact) => {
    const db = createClient()
    const { error } = await db
      .from('contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', contact.id)
    if (error) {
      console.error('[today] mark contacted failed:', error)
      toast.error('Failed to mark as contacted')
      return
    }
    setHotLeads((prev) => (prev ? prev.filter((l) => l.contact.id !== contact.id) : prev))
    toast.success(`${contact.name || contact.phone} marked as contacted`)
  }

  const handleOpenChatForContact = async (contact: Contact) => {
    const db = createClient()
    const { data, error } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) console.error('[today] conversation lookup failed:', error)
    const conversationId = (data as { id: string }[] | null)?.[0]?.id
    if (conversationId) {
      router.push(`/inbox?c=${conversationId}`)
    } else {
      // No thread yet — fall back to WhatsApp directly.
      window.open(`https://wa.me/${contact.phone.replace(/\D/g, '')}`, '_blank')
    }
  }

  /** Open native WhatsApp, mark contacted, and log a note in one click. */
  const handleWhatsAppDirect = async (contact: Contact) => {
    // 1. Open WhatsApp immediately (must be synchronous for popup blocker)
    window.open(`https://wa.me/${contact.phone.replace(/\D/g, '')}`, '_blank')

    // 2. Mark contacted + log note in the background
    const db = createClient()
    const now = new Date().toISOString()

    const [contactRes, noteRes] = await Promise.allSettled([
      db
        .from('contacts')
        .update({ last_contacted_at: now })
        .eq('id', contact.id),
      db
        .from('contact_notes')
        .insert({
          contact_id: contact.id,
          user_id: user?.id,
          account_id: accountId,
          note_text: '📱 Contacted via personal WhatsApp',
        }),
    ])

    const contactErr = contactRes.status === 'fulfilled' ? contactRes.value.error : contactRes.reason
    const noteErr = noteRes.status === 'fulfilled' ? noteRes.value.error : noteRes.reason

    if (contactErr) console.error('[today] whatsapp mark contacted failed:', contactErr)
    if (noteErr) console.error('[today] whatsapp note insert failed:', noteErr)

    // 3. Optimistically remove the card
    setHotLeads((prev) => (prev ? prev.filter((l) => l.contact.id !== contact.id) : prev))
    toast.success(`Opened WhatsApp for ${contact.name || contact.phone}`)
  }

  const completeAgendaItem = (kind: 'appointment' | 'todo', item: AgendaAppointment | AgendaTodo) => {
    const key = `${kind}-${item.id}`
    setCompleting((prev) => new Set(prev).add(key))

    // Optimistic: strikethrough now, drop the row 400ms later.
    window.setTimeout(() => {
      setAgenda((prev) => {
        if (!prev) return prev
        return kind === 'appointment'
          ? { ...prev, appointments: prev.appointments.filter((a) => a.id !== item.id) }
          : { ...prev, todos: prev.todos.filter((t) => t.id !== item.id) }
      })
      setCompleting((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 400)

    const db = createClient()
    const update =
      kind === 'appointment'
        ? db.from('appointments').update({ status: 'completed' }).eq('id', item.id)
        : db.from('todos').update({ completed: true }).eq('id', item.id)

    void update.then(({ error }) => {
      if (!error) return
      console.error(`[today] complete ${kind} failed:`, error)
      toast.error(`Failed to complete ${kind === 'appointment' ? 'appointment' : 'to-do'}`)
      // Revert: un-strike and put the row back in order.
      setCompleting((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setAgenda((prev) => {
        if (!prev) return prev
        if (kind === 'appointment') {
          const appt = item as AgendaAppointment
          if (prev.appointments.some((a) => a.id === appt.id)) return prev
          const appointments = [...prev.appointments, appt].sort((a, b) =>
            a.start_time.localeCompare(b.start_time),
          )
          return { ...prev, appointments }
        }
        const todo = item as AgendaTodo
        if (prev.todos.some((t) => t.id === todo.id)) return prev
        const todos = [...prev.todos, todo].sort((a, b) => a.due_date.localeCompare(b.due_date))
        return { ...prev, todos }
      })
    })
  }

  const anyLoading = expiringLoading || hotLoading || agendaLoading
  const show = (key: Exclude<SectionFilter, 'all'>) => filter === 'all' || filter === key

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Today</h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Everything that needs your attention right now — reply windows, cooling leads, and today&apos;s schedule.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadAll}
          disabled={anyLoading}
          className="shrink-0 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900/40 rounded-xl cursor-pointer"
        >
          <RefreshCw className={`size-3.5 ${anyLoading ? 'animate-spin' : ''}`} />
          {refreshedLabel(refreshedAt, now)} · Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Windows closing"
          value={windowsClosing.length}
          loading={expiringLoading}
          icon={<Timer className="size-4 text-rose-400" />}
          valueClass="text-rose-400"
        />
        <StatCard
          label="Hot going quiet"
          value={hotLeads?.length ?? 0}
          loading={hotLoading}
          icon={<Flame className="size-4 text-amber-400" />}
          valueClass="text-amber-400"
        />
        <StatCard
          label="Awaiting reply"
          value={awaitingReply.length}
          loading={expiringLoading}
          icon={<MessagesSquare className="size-4 text-sky-400" />}
          valueClass="text-sky-400"
        />
        <StatCard
          label="Today's agenda"
          value={agendaCount}
          loading={agendaLoading}
          icon={<CalendarDays className="size-4 text-emerald-400" />}
          valueClass="text-emerald-400"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              filter === chip.key
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* a) Windows closing */}
      {show('windows') && (
        <Section title="⏳ WhatsApp windows closing" count={windowsClosing.length}>
          {expiringLoading ? (
            <SkeletonRows />
          ) : windowsClosing.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-3">
              {windowsClosing.map((item) => (
                <SessionCard
                  key={item.conversation.id}
                  item={item}
                  now={now}
                  mode="countdown"
                  onHandled={handleHandled}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* b) Hot leads going quiet */}
      {show('hot') && (
        <Section title="🔥 Hot leads going quiet" count={hotLeads?.length ?? 0}>
          {hotLoading ? (
            <SkeletonRows />
          ) : !hotLeads || hotLeads.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-3">
              {hotLeads.map(({ contact, daysSilent }) => (
                <div
                  key={contact.id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar className="size-9 border border-slate-800 shrink-0">
                      <AvatarFallback className="bg-amber-500/10 text-xs font-black text-amber-400">
                        {(contact.name || contact.phone).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-white truncate">
                          {contact.name || contact.phone}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-400">
                          {silentLabel(daysSilent)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400 font-medium">
                        {contact.no_budget
                          ? 'Budget: no limit'
                          : contact.max_budget
                            ? `Budget: ${formatBudget(contact.max_budget)}`
                            : 'Budget: not specified'}
                      </p>
                      {contact.areas_of_interest && contact.areas_of_interest.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {contact.areas_of_interest.slice(0, 3).map((area) => (
                            <span
                              key={area}
                              className="inline-flex items-center rounded-lg bg-slate-950/40 border border-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-400"
                            >
                              {area}
                            </span>
                          ))}
                          {contact.areas_of_interest.length > 3 && (
                            <span className="text-[9px] font-bold text-slate-500 self-center">
                              +{contact.areas_of_interest.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => void handleOpenChatForContact(contact)}
                      className="text-xs font-bold rounded-xl cursor-pointer"
                    >
                      <MessageSquare className="size-3.5" />
                      Open chat
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleWhatsAppDirect(contact)}
                      className="text-xs font-bold rounded-xl cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Smartphone className="size-3.5" />
                      WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleMarkContacted(contact)}
                      className="text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl cursor-pointer"
                    >
                      <Check className="size-3.5" />
                      Mark contacted
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* c) Awaiting your reply */}
      {show('replies') && (
        <Section title="💬 Awaiting your reply" count={awaitingReply.length}>
          {expiringLoading ? (
            <SkeletonRows />
          ) : awaitingReply.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-3">
              {awaitingReply.map((item) => (
                <SessionCard
                  key={item.conversation.id}
                  item={item}
                  now={now}
                  mode="ago"
                  onHandled={handleHandled}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* d) Today's agenda */}
      {show('agenda') && (
        <Section title="📅 Today's agenda" count={agendaCount}>
          {agendaLoading ? (
            <SkeletonRows />
          ) : agendaCount === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-3">
              {agenda?.appointments.map((appt) => {
                const striking = completing.has(`appointment-${appt.id}`)
                return (
                  <div
                    key={appt.id}
                    className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => completeAgendaItem('appointment', appt)}
                      disabled={striking}
                      aria-label={`Mark appointment "${appt.title}" completed`}
                      className={`size-5 shrink-0 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                        striking
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                          : 'border-slate-600 hover:border-emerald-400 text-transparent hover:text-emerald-400/60'
                      }`}
                    >
                      <Check className="size-3" />
                    </button>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 shrink-0">
                      <Clock className="size-3" />
                      {timeChip(appt.start_time)}
                    </span>
                    <div className={`min-w-0 flex-1 ${striking ? 'line-through opacity-50' : ''}`}>
                      <p className="text-sm font-bold text-white truncate">{appt.title}</p>
                      <p className="text-xs text-slate-400 font-medium truncate">
                        {[
                          appt.contact?.name || appt.contact?.phone,
                          appt.property?.title,
                          appt.property?.location || appt.location,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No details'}
                      </p>
                    </div>
                  </div>
                )
              })}
              {agenda?.todos.map((todo) => {
                const striking = completing.has(`todo-${todo.id}`)
                const overdue = new Date(todo.due_date).getTime() < now
                return (
                  <div
                    key={todo.id}
                    className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => completeAgendaItem('todo', todo)}
                      disabled={striking}
                      aria-label={`Mark to-do "${todo.title}" completed`}
                      className={`size-5 shrink-0 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                        striking
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                          : 'border-slate-600 hover:border-emerald-400 text-transparent hover:text-emerald-400/60'
                      }`}
                    >
                      <Check className="size-3" />
                    </button>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                        overdue
                          ? 'border-rose-500/25 bg-rose-500/10 text-rose-400'
                          : 'border-slate-700 bg-slate-800/60 text-slate-300'
                      }`}
                    >
                      <Clock className="size-3" />
                      {overdue ? 'Overdue' : `Due ${timeChip(todo.due_date)}`}
                    </span>
                    <div className={`min-w-0 flex-1 ${striking ? 'line-through opacity-50' : ''}`}>
                      <p className="text-sm font-bold text-white truncate">{todo.title}</p>
                      {(todo.contact || todo.property) && (
                        <p className="text-xs text-slate-400 font-medium truncate">
                          {[todo.contact?.name || todo.contact?.phone, todo.property?.title]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Building blocks
// ------------------------------------------------------------

function StatCard({
  label,
  value,
  loading,
  icon,
  valueClass,
}: {
  label: string
  value: number
  loading: boolean
  icon: React.ReactNode
  valueClass: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className={`mt-2.5 text-2xl font-black ${valueClass}`}>
        {loading ? <div className="h-8 w-10 animate-pulse rounded-lg bg-slate-800" /> : value}
      </div>
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-black text-white flex items-center gap-2">
        {title}
        <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-bold text-slate-300">
          {count}
        </span>
      </h2>
      {children}
    </section>
  )
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-slate-800 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center">
      <p className="text-xs font-medium text-slate-500">All clear here ✓</p>
    </div>
  )
}

function SessionCard({
  item,
  now,
  mode,
  onHandled,
}: {
  item: ExpiringSessionItem
  now: number
  mode: 'countdown' | 'ago'
  onHandled: (conversationId: string) => void
}) {
  const { conversation, contact, lastCustomerAt, expiresAt } = item
  const displayName = contact?.name || contact?.phone || 'Unknown contact'
  const urgent = new Date(expiresAt).getTime() - now < 2 * HOUR_MS

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <Avatar className="size-9 border border-slate-800 shrink-0">
          <AvatarFallback className="bg-primary/10 text-xs font-black text-primary">
            {displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black text-white truncate">{displayName}</span>
            {classificationBadge(contact)}
            {mode === 'countdown' ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  urgent
                    ? 'border-rose-500/25 bg-rose-500/10 text-rose-400'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-400'
                }`}
              >
                <Timer className="size-3" />
                {countdownLabel(expiresAt, now)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                <Clock className="size-3" />
                {agoLabel(lastCustomerAt, now)}
              </span>
            )}
          </div>
          {conversation.last_message_text && (
            <p className="mt-1 text-xs text-slate-400 font-medium truncate max-w-md">
              {conversation.last_message_text}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/inbox?c=${conversation.id}`}
          className={cn(buttonVariants({ size: 'sm' }), 'text-xs font-bold rounded-xl')}
        >
          <MessageSquare className="size-3.5" />
          Open chat
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onHandled(conversation.id)}
          className="text-xs font-bold text-slate-500 hover:text-white hover:bg-slate-800/60 rounded-xl cursor-pointer"
        >
          Handled ✓
        </Button>
      </div>
    </div>
  )
}
