"use client";

import Link from "next/link";
import { Check, CheckCircle2, Clock, ExternalLink, Loader2, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { deadlineLabel, type DealDeadline } from "@/lib/deals/deadlines";
import { DEAL_DATE_KIND_LABELS, dealDateHref, dealDateKey } from "@/lib/calendar/deal-dates";
import {
  APPOINTMENT_STATUS_LABELS,
  appointmentStatusActions,
  groupCalendarTaskRows,
  type AppointmentStatus,
  type CalendarTaskRow,
} from "@/lib/calendar/tasks-view";
import {
  CalendarEvent,
  TeamMember,
  DEAL_DATE_META,
  eventTypeMeta,
  memberInitials,
  formatTimeShort,
} from "./event-types";

interface TasksListProps {
  rows: CalendarTaskRow<CalendarEvent, DealDeadline>[];
  members: TeamMember[];
  /** Viewers and read-only members see the list; only editors get the write actions. */
  canEdit: boolean;
  /** Key of the row whose write is in flight (appointment id or deal date key). */
  busyKey: string | null;
  onEventClick: (event: CalendarEvent) => void;
  onStatusChange: (event: CalendarEvent, status: AppointmentStatus) => void;
  onMilestoneDone: (dealDate: DealDeadline) => void;
}

function dayHeading(dayKey: string): string {
  const date = new Date(
    Number(dayKey.slice(0, 4)),
    Number(dayKey.slice(5, 7)) - 1,
    Number(dayKey.slice(8, 10))
  );
  const today = new Date();
  const label = date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return date.toDateString() === today.toDateString() ? `Today · ${label}` : label;
}

const STATUS_PILL: Record<AppointmentStatus, string> = {
  scheduled: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

const ACTION_ICON: Record<AppointmentStatus, typeof Check> = {
  completed: Check,
  cancelled: XCircle,
  scheduled: RotateCcw,
};

/** Everything pinned on the visible days, in date order (CAL-010).
 *  An appointment's status is changed in place — Done, Cancel, Reopen —
 *  and a cancelled one stays on its day struck through. A milestone
 *  date can be ticked done through the deal route; other deal dates
 *  open the record. */
export function TasksList({
  rows,
  members,
  canEdit,
  busyKey,
  onEventClick,
  onStatusChange,
  onMilestoneDone,
}: TasksListProps) {
  const days = groupCalendarTaskRows(rows);
  const memberFor = (ev: CalendarEvent) =>
    members.find((m) => m.user_id === (ev.assigned_to || ev.user_id));

  if (days.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-500">
        Nothing pinned on these days yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {days.map((day) => (
        <div key={day.dayKey}>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {dayHeading(day.dayKey)}
            <span className="ml-2 font-normal normal-case text-slate-600">
              {day.rows.length} item{day.rows.length === 1 ? "" : "s"}
            </span>
          </h3>
          <div className="space-y-1.5">
            {day.rows.map((row) =>
              row.kind === "deal" ? (
                <DealDateRow
                  key={dealDateKey(row.dealDate)}
                  dealDate={row.dealDate}
                  canEdit={canEdit}
                  busy={busyKey === dealDateKey(row.dealDate)}
                  onDone={onMilestoneDone}
                />
              ) : (
                <AppointmentRow
                  key={row.appointment.id}
                  event={row.appointment}
                  assignee={members.length > 1 ? memberFor(row.appointment) : undefined}
                  canEdit={canEdit}
                  busy={busyKey === row.appointment.id}
                  onOpen={onEventClick}
                  onStatusChange={onStatusChange}
                />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AppointmentRow({
  event,
  assignee,
  canEdit,
  busy,
  onOpen,
  onStatusChange,
}: {
  event: CalendarEvent;
  assignee?: TeamMember;
  canEdit: boolean;
  busy: boolean;
  onOpen: (event: CalendarEvent) => void;
  onStatusChange: (event: CalendarEvent, status: AppointmentStatus) => void;
}) {
  const meta = eventTypeMeta(event.event_type);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2",
        event.status === "cancelled" && "opacity-60"
      )}
    >
      <span className="w-16 shrink-0 font-mono text-[11px] text-slate-400">{formatTimeShort(event.start_time)}</span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chip)}>
        {event.status === "completed" ? <CheckCircle2 className="h-3 w-3" /> : <meta.icon className="h-3 w-3" />}
        <span className="hidden sm:inline">{meta.label}</span>
      </span>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="min-w-0 flex-1 text-left"
        title="Open"
      >
        <span className={cn("block truncate text-xs font-semibold text-white", event.status === "cancelled" && "line-through")}>
          {event.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
          {event.contact?.name && <span className="truncate">{event.contact.name}</span>}
          {event.property?.title && <span className="truncate">{event.property.title}</span>}
          {assignee && <span>{memberInitials(assignee.full_name)}</span>}
        </span>
      </button>
      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase", canEdit ? "hidden sm:inline" : "inline", STATUS_PILL[event.status])}>
        {APPOINTMENT_STATUS_LABELS[event.status]}
      </span>
      {canEdit && (
      <span className="flex shrink-0 items-center gap-1">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : (
          appointmentStatusActions(event.status).map((action) => {
            const Icon = ACTION_ICON[action.status];
            return (
              <button
                key={action.status}
                type="button"
                onClick={() => onStatusChange(event, action.status)}
                title={`${action.label} — ${APPOINTMENT_STATUS_LABELS[action.status]}`}
                aria-label={`${action.label}: ${event.title}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                  action.status === "completed" && "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10",
                  action.status === "cancelled" && "border-rose-500/30 text-rose-300 hover:bg-rose-500/10",
                  action.status === "scheduled" && "border-slate-700 text-slate-300 hover:bg-slate-800"
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{action.label}</span>
              </button>
            );
          })
        )}
      </span>
      )}
    </div>
  );
}

function DealDateRow({
  dealDate,
  canEdit,
  busy,
  onDone,
}: {
  dealDate: DealDeadline;
  canEdit: boolean;
  busy: boolean;
  onDone: (dealDate: DealDeadline) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
      <span className="w-16 shrink-0 font-mono text-[11px] text-slate-500">All day</span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", DEAL_DATE_META.chip)}>
        <DEAL_DATE_META.icon className="h-3 w-3" />
        <span className="hidden sm:inline">{DEAL_DATE_KIND_LABELS[dealDate.kind]}</span>
      </span>
      <Link href={dealDateHref(dealDate.dealId)} className="min-w-0 flex-1" title="Open the deal">
        <span className="block truncate text-xs font-semibold text-white">{dealDate.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
          <span className="truncate">{dealDate.subject}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              dealDate.urgency === "overdue" ? "text-rose-400" : dealDate.urgency === "today" ? "text-amber-300" : undefined
            )}
          >
            <Clock className="h-2.5 w-2.5" />
            {deadlineLabel(dealDate.daysLeft)}
          </span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : canEdit && dealDate.kind === "milestone" && dealDate.milestoneId ? (
          <button
            type="button"
            onClick={() => onDone(dealDate)}
            title="Mark this milestone done on the deal"
            aria-label={`Done: ${dealDate.title}`}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
          >
            <Check className="h-3 w-3" />
            <span className="hidden md:inline">Done</span>
          </button>
        ) : (
          <Link
            href={dealDateHref(dealDate.dealId)}
            aria-label={`Open deal: ${dealDate.subject}`}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="hidden md:inline">Open deal</span>
          </Link>
        )}
      </span>
    </div>
  );
}
