"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, MapPin, User, Home, CheckCircle2 } from "lucide-react";
import { CalendarEvent, TeamMember, eventTypeMeta, memberInitials, formatTimeShort } from "./event-types";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";

interface AgendaViewProps {
  events: CalendarEvent[];
  members: TeamMember[];
  onEventClick: (event: CalendarEvent) => void;
}

function dayHeading(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const label = date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  if (date.toDateString() === today.toDateString()) return `Today · ${label}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${label}`;
  return label;
}

/** One scrollable, chronological list of everything scheduled —
 *  grouped by day, upcoming first, with finished/past events tucked
 *  behind a toggle so the working list stays clean. */
export function AgendaView({ events, members, onEventClick }: AgendaViewProps) {
  const [showPast, setShowPast] = useState(false);

  const { upcomingGroups, pastGroups } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sorted = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    const group = (list: CalendarEvent[]) => {
      const map = new Map<string, { date: Date; events: CalendarEvent[] }>();
      for (const ev of list) {
        const d = new Date(ev.start_time);
        const key = d.toDateString();
        let entry = map.get(key);
        if (!entry) {
          entry = { date: d, events: [] };
          map.set(key, entry);
        }
        entry.events.push(ev);
      }
      return [...map.values()];
    };

    const upcoming = sorted.filter((ev) => new Date(ev.start_time) >= startOfToday);
    const past = sorted.filter((ev) => new Date(ev.start_time) < startOfToday).reverse();

    return { upcomingGroups: group(upcoming), pastGroups: group(past) };
  }, [events]);

  const memberFor = (ev: CalendarEvent) => members.find((m) => m.user_id === (ev.assigned_to || ev.user_id));

  const renderRow = (ev: CalendarEvent) => {
    const meta = eventTypeMeta(ev.event_type);
    const assignee = memberFor(ev);
    return (
      <button
        key={ev.id}
        onClick={() => onEventClick(ev)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-950",
          ev.status === "cancelled" && "opacity-50",
          ev.status === "completed" && "opacity-60"
        )}
      >
        <span className="w-16 shrink-0 font-mono text-[11px] text-slate-400">{formatTimeShort(ev.start_time)}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chip)}>
          {ev.status === "completed" ? <CheckCircle2 className="h-3 w-3" /> : <meta.icon className="h-3 w-3" />}
          <span className="hidden sm:inline">{meta.label}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-xs font-semibold text-white", ev.status === "cancelled" && "line-through")}>
            {ev.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
            {ev.contact?.name && (
              <span className="inline-flex items-center gap-1"><User className="h-2.5 w-2.5" />{ev.contact.name}<NameTagBadge tag={ev.contact.name_tag} /></span>
            )}
            {ev.property?.title && (
              <span className="inline-flex items-center gap-1"><Home className="h-2.5 w-2.5" />{ev.property.title}</span>
            )}
            {ev.location && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{ev.location}</span>
            )}
          </span>
        </span>
        {members.length > 1 && assignee && (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary"
            title={assignee.full_name}
          >
            {memberInitials(assignee.full_name)}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex-1 space-y-4 overflow-y-auto pr-1 min-h-0">
      {upcomingGroups.length === 0 && (
        <div className="flex h-40 flex-col items-center justify-center text-center text-slate-500">
          <p className="text-xs">Nothing scheduled yet — use the smart bar above to log your first event.</p>
        </div>
      )}

      {upcomingGroups.map((group) => (
        <div key={group.date.toDateString()}>
          <h3 className="sticky top-0 z-10 mb-1.5 bg-slate-900/95 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
            {dayHeading(group.date)}
            <span className="ml-2 font-normal normal-case text-slate-600">
              {group.events.length} event{group.events.length === 1 ? "" : "s"}
            </span>
          </h3>
          <div className="space-y-1.5">{group.events.map(renderRow)}</div>
        </div>
      ))}

      {pastGroups.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <button
            onClick={() => setShowPast(!showPast)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-white transition-colors"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPast && "rotate-180")} />
            {showPast ? "Hide past events" : `Show past events (${pastGroups.reduce((n, g) => n + g.events.length, 0)})`}
          </button>
          {showPast && (
            <div className="mt-3 space-y-4">
              {pastGroups.map((group) => (
                <div key={group.date.toDateString()}>
                  <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {dayHeading(group.date)}
                  </h3>
                  <div className="space-y-1.5">{group.events.map(renderRow)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
