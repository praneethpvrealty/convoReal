"use client"

/**
 * Focus — the consultant's landing view.
 *
 * Three questions in one screen: what am I doing today, which
 * relationships need me, and who is waiting on an answer. Each gist
 * card shows the head of its list and expands in place into the full
 * card — journeys expand into the real Journey map, not a summary of
 * it — so the day's work never costs a navigation.
 *
 * The ranking is not decided here. GET /api/focus returns it already
 * ordered so the mobile Focus screen shows the same three.
 */

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Gavel,
  Inbox,
  MapPin,
  Radar,
  RefreshCw,
  Sparkles,
  UserRound,
  Waypoints,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { pushUrl } from "@/lib/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { ConvoRealLoader } from "@/components/ui/convoreal-loader"
import { JourneyEmbed } from "@/components/journey/journey-embed"
import type {
  FocusJourney,
  FocusRequest,
  FocusRequestKind,
  FocusSnapshot,
  FocusTask,
} from "@/lib/focus/types"

type SectionId = "tasks" | "journeys" | "requests"

const REQUEST_META: Record<
  FocusRequestKind,
  { label: string; icon: typeof Inbox; tint: string }
> = {
  bid: { label: "Offer", icon: Gavel, tint: "text-emerald-400" },
  listing_submission: { label: "Listing", icon: Building2, tint: "text-violet-400" },
  inquiry: { label: "Inquiry", icon: Inbox, tint: "text-sky-400" },
  match: { label: "Radar", icon: Radar, tint: "text-amber-400" },
}

const URGENCY_CLASS = {
  now: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  soon: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  later: "border-slate-700 bg-slate-800/60 text-slate-300",
} as const

const URGENCY_LABEL = { now: "Now", soon: "Soon", later: "When you can" } as const

function timeChip(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function waitedLabel(hours: number): string {
  if (hours < 1) return "just now"
  if (hours < 24) return `waiting ${hours}h`
  const days = Math.floor(hours / 24)
  return `waiting ${days} day${days === 1 ? "" : "s"}`
}

async function fetchFocus(): Promise<FocusSnapshot> {
  const res = await fetch("/api/focus")
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? "Failed to load Focus")
  return body.data as FocusSnapshot
}

export default function FocusContent() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { accountId } = useAuth()

  const [expanded, setExpanded] = useState<Set<SectionId>>(new Set())
  const [openJourney, setOpenJourney] = useState<string | null>(null)
  const [completed, setCompleted] = useState<Set<string>>(new Set())

  const focusQuery = useQuery({
    queryKey: ["focus", accountId],
    queryFn: fetchFocus,
    enabled: Boolean(accountId),
  })

  const snapshot = focusQuery.data
  const toggle = (id: SectionId) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Optimistic completion: strike the row now, refetch once the write
  // lands. A failure puts the row back rather than leaving a task the
  // agent believes is done.
  const completeTodo = async (task: FocusTask) => {
    setCompleted((prev) => new Set(prev).add(task.id))
    try {
      const res = await fetch(`/api/todos/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? "Failed to complete")
      toast.success("Marked done")
      await queryClient.invalidateQueries({ queryKey: ["focus", accountId] })
    } catch (err) {
      console.error("[focus] complete todo failed:", err)
      toast.error("Failed to complete that to-do")
      setCompleted((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }
  }

  const tasks = snapshot?.tasks
  const openTasks = useMemo(
    () => (tasks?.items ?? []).filter((t) => !completed.has(t.id)),
    [tasks, completed],
  )

  if (focusQuery.isLoading) {
    return <ConvoRealLoader className="mx-auto my-20" />
  }

  if (focusQuery.isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <p className="text-sm font-bold text-rose-300">Focus could not load.</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => focusQuery.refetch()}
          className="mt-3 text-xs font-bold text-slate-300 cursor-pointer"
        >
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    )
  }

  const journeys = snapshot?.journeys
  const requests = snapshot?.requests

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white">Focus</h2>
          <p className="mt-1.5 text-xs sm:text-sm font-medium leading-relaxed text-slate-400">
            Your day in three answers — what you committed to, which relationships
            need a nudge, and who is waiting on you. Expand any card to work it
            here.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => focusQuery.refetch()}
          disabled={focusQuery.isFetching}
          className="shrink-0 cursor-pointer rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-900/40 hover:text-white"
        >
          <RefreshCw className={cn("size-3.5", focusQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GistCard
          id="tasks"
          title="Tasks & visits"
          icon={<ClipboardList className="size-4 text-emerald-400" />}
          count={openTasks.length}
          summary={
            tasks
              ? [
                  `${tasks.visits} visit${tasks.visits === 1 ? "" : "s"}`,
                  `${tasks.appointments} appointment${tasks.appointments === 1 ? "" : "s"}`,
                  `${tasks.todos} to-do${tasks.todos === 1 ? "" : "s"}`,
                  ...(tasks.overdue > 0 ? [`${tasks.overdue} overdue`] : []),
                ].join(" · ")
              : ""
          }
          expanded={expanded.has("tasks")}
          onToggle={() => toggle("tasks")}
          emptyText="Nothing scheduled — the day is yours."
        >
          {openTasks.slice(0, 3).map((task) => (
            <TaskLine key={task.id} task={task} />
          ))}
        </GistCard>

        <GistCard
          id="journeys"
          title="Top journeys"
          icon={<Waypoints className="size-4 text-violet-400" />}
          count={journeys?.all.length ?? 0}
          summary={
            journeys?.all.length
              ? `${journeys.all.length} live journey${journeys.all.length === 1 ? "" : "s"} · ranked by priority, then how close to closing`
              : ""
          }
          expanded={expanded.has("journeys")}
          onToggle={() => toggle("journeys")}
          emptyText="No live journeys yet. Add one from a contact or a listing."
        >
          {(journeys?.top ?? []).map((journey) => (
            <JourneyLine key={`${journey.mode}:${journey.subjectId}`} journey={journey} />
          ))}
        </GistCard>

        <GistCard
          id="requests"
          title="Requests to act on"
          icon={<Sparkles className="size-4 text-sky-400" />}
          count={requests?.all.length ?? 0}
          summary={
            requests?.all.length
              ? `${requests.all.filter((r) => r.urgency === "now").length} needing an answer now`
              : ""
          }
          expanded={expanded.has("requests")}
          onToggle={() => toggle("requests")}
          emptyText="Nobody is waiting on you."
        >
          {(requests?.top ?? []).map((request) => (
            <RequestLine key={request.id} request={request} />
          ))}
        </GistCard>
      </div>

      {expanded.has("tasks") && (
        <Panel
          title="Tasks & visits"
          subtitle="Everything due today, plus anything that slipped from an earlier day."
          onOpenFull={() => pushUrl(router, "/calendar")}
          openLabel="Open calendar"
        >
          {openTasks.length === 0 ? (
            <EmptyPanel text="Nothing left for today." />
          ) : (
            <div className="flex flex-col gap-2">
              {openTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5"
                >
                  <div className="mt-0.5 shrink-0">
                    {task.kind === "appointment" ? (
                      <CalendarDays className="size-4 text-emerald-400" />
                    ) : (
                      <ClipboardList className="size-4 text-sky-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{task.title}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                      {[
                        timeChip(task.at),
                        task.location,
                        task.contact?.name,
                        task.property?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {task.overdue && (
                    <span className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      Overdue
                    </span>
                  )}
                  {task.kind === "todo" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => completeTodo(task)}
                      className="h-7 shrink-0 cursor-pointer rounded-lg px-2 text-[11px] font-bold text-slate-400 hover:text-emerald-300"
                    >
                      <Check className="size-3.5" />
                      Done
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {expanded.has("journeys") && (
        <Panel
          title="Top journeys"
          subtitle="Pick one to open its map here — advance, drop and plan without leaving Focus."
          onOpenFull={() => pushUrl(router, "/journey")}
          openLabel="Open all journeys"
        >
          {(journeys?.top ?? []).length === 0 ? (
            <EmptyPanel text="No live journeys to rank yet." />
          ) : (
            <div className="flex flex-col gap-3">
              {(journeys?.top ?? []).map((journey) => {
                const key = `${journey.mode}:${journey.subjectId}`
                const open = openJourney === key
                return (
                  <div
                    key={key}
                    className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenJourney(open ? null : key)}
                      className="flex w-full cursor-pointer items-center gap-3 p-3.5 text-left hover:bg-slate-900/40"
                    >
                      {journey.mode === "buyer" ? (
                        <UserRound className="size-4 shrink-0 text-sky-400" />
                      ) : (
                        <Building2 className="size-4 shrink-0 text-violet-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">
                          {journey.subject.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                          {journey.reason}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-slate-500 transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </button>
                    {open && (
                      <div className="border-t border-slate-800 p-3">
                        <JourneyEmbed mode={journey.mode} subjectId={journey.subjectId} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      )}

      {expanded.has("requests") && (
        <Panel
          title="Requests to act on"
          subtitle="Offers, listing submissions, property inquiries and Radar matches, ranked together."
          onOpenFull={() => pushUrl(router, "/dashboard?tab=radar")}
          openLabel="Open Match Radar"
        >
          {(requests?.all ?? []).length === 0 ? (
            <EmptyPanel text="Nothing inbound is waiting." />
          ) : (
            <div className="flex flex-col gap-2">
              {(requests?.all ?? []).map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  onOpen={() => pushUrl(router, request.href)}
                />
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function GistCard({
  title,
  icon,
  count,
  summary,
  expanded,
  onToggle,
  emptyText,
  children,
}: {
  id: SectionId
  title: string
  icon: React.ReactNode
  count: number
  summary: string
  expanded: boolean
  onToggle: () => void
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border bg-slate-900 p-5 transition-colors",
        expanded ? "border-primary/40" : "border-slate-800",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          {icon}
          {title}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-bold text-slate-300">
          {count}
        </span>
      </div>

      {summary && (
        <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
          {summary}
        </p>
      )}

      <div className="mt-3 flex-1 space-y-2">
        {count === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-[11px] font-medium text-slate-500">
            {emptyText}
          </p>
        ) : (
          children
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className="mt-3 w-full cursor-pointer rounded-xl text-[11px] font-bold text-slate-400 hover:bg-slate-800/40 hover:text-white"
      >
        {expanded ? "Collapse" : "Expand"}
        <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
      </Button>
    </section>
  )
}

function TaskLine({ task }: { task: FocusTask }) {
  return (
    <div className="flex items-center gap-2">
      {task.kind === "appointment" && task.location ? (
        <MapPin className="size-3.5 shrink-0 text-emerald-400" />
      ) : task.kind === "appointment" ? (
        <CalendarDays className="size-3.5 shrink-0 text-emerald-400" />
      ) : (
        <ClipboardList className="size-3.5 shrink-0 text-sky-400" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">
        {task.title}
      </span>
      <span
        className={cn(
          "shrink-0 text-[10px] font-bold",
          task.overdue ? "text-rose-300" : "text-slate-500",
        )}
      >
        {task.overdue ? "Overdue" : timeChip(task.at)}
      </span>
    </div>
  )
}

function JourneyLine({ journey }: { journey: FocusJourney }) {
  return (
    <div className="flex items-center gap-2">
      {journey.mode === "buyer" ? (
        <UserRound className="size-3.5 shrink-0 text-sky-400" />
      ) : (
        <Building2 className="size-3.5 shrink-0 text-violet-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-200">
          {journey.subject.name}
        </p>
        <p className="truncate text-[10px] font-medium text-slate-500">{journey.reason}</p>
      </div>
    </div>
  )
}

function RequestLine({ request }: { request: FocusRequest }) {
  const meta = REQUEST_META[request.kind]
  return (
    <div className="flex items-center gap-2">
      <meta.icon className={cn("size-3.5 shrink-0", meta.tint)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-200">{request.title}</p>
        <p className="truncate text-[10px] font-medium text-slate-500">
          {waitedLabel(request.ageHours)}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold",
          URGENCY_CLASS[request.urgency],
        )}
      >
        {URGENCY_LABEL[request.urgency]}
      </span>
    </div>
  )
}

function RequestRow({
  request,
  onOpen,
}: {
  request: FocusRequest
  onOpen: () => void
}) {
  const meta = REQUEST_META[request.kind]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5 text-left hover:border-slate-700 hover:bg-slate-900/40"
    >
      <meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.tint)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{request.title}</p>
        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
          {[meta.label, request.detail, waitedLabel(request.ageHours)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
          URGENCY_CLASS[request.urgency],
        )}
      >
        {URGENCY_LABEL[request.urgency]}
      </span>
    </button>
  )
}

function Panel({
  title,
  subtitle,
  onOpenFull,
  openLabel,
  children,
}: {
  title: string
  subtitle: string
  onOpenFull: () => void
  openLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-white">{title}</h3>
          <p className="mt-1 text-[11px] font-medium text-slate-500">{subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenFull}
          className="shrink-0 cursor-pointer rounded-xl text-[11px] font-bold text-slate-400 hover:text-white"
        >
          {openLabel}
        </Button>
      </div>
      {children}
    </section>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center">
      <p className="text-xs font-medium text-slate-500">{text}</p>
    </div>
  )
}
