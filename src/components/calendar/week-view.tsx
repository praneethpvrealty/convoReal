"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CalendarEvent, TeamMember, eventTypeMeta, memberInitials, formatTimeShort } from "./event-types";

interface WeekViewProps {
  events: CalendarEvent[];
  members: TeamMember[];
  selectedDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: Date) => void;
}

/** Agenda-style week: seven columns of time-ordered event cards with
 *  assignee initials, so a whole week of visits/calls scans in one look. */
export function WeekView({ events, members, selectedDate, onEventClick, onSlotClick }: WeekViewProps) {
  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      const key = new Date(ev.start_time).toDateString();
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    }
    return map;
  }, [events]);

  const memberName = (ev: CalendarEvent) =>
    members.find((m) => m.user_id === (ev.assigned_to || ev.user_id))?.full_name;

  const todayStr = new Date().toDateString();

  return (
    <div className="grid flex-1 grid-cols-7 gap-px overflow-y-auto rounded-lg bg-slate-800/40 min-h-0">
      {weekDays.map((day) => {
        const dayEvents = eventsByDay[day.toDateString()] || [];
        const isToday = day.toDateString() === todayStr;
        return (
          <div key={day.toISOString()} className="flex min-h-[300px] flex-col bg-slate-950">
            <button
              onClick={() => onSlotClick(day)}
              className={cn(
                "sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-2 py-2 text-center hover:bg-slate-900 transition-colors",
                isToday && "border-b-primary/50"
              )}
            >
              <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                {day.toLocaleDateString("en-IN", { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                  isToday ? "bg-primary text-primary-foreground" : "text-slate-300"
                )}
              >
                {day.getDate()}
              </span>
            </button>
            <div className="flex-1 space-y-1 p-1.5">
              {dayEvents.map((ev) => {
                const meta = eventTypeMeta(ev.event_type);
                const assignee = memberName(ev);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    className={cn(
                      "block w-full rounded-md border px-1.5 py-1 text-left text-[10px] leading-snug transition-colors",
                      meta.chip,
                      ev.status === "cancelled" && "line-through opacity-50",
                      ev.status === "completed" && "opacity-60"
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <meta.icon className="h-2.5 w-2.5 shrink-0" />
                      <span className="font-mono text-[9px] opacity-80">{formatTimeShort(ev.start_time)}</span>
                      {assignee && (
                        <span className="ml-auto rounded bg-slate-900/60 px-1 text-[8px] font-bold" title={assignee}>
                          {memberInitials(assignee)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate font-semibold">{ev.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
