"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { CalendarEvent, TeamMember, eventTypeMeta, memberInitials, formatTimeShort } from "./event-types";

interface TeamViewProps {
  events: CalendarEvent[];
  members: TeamMember[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: Date, assignedTo: string) => void;
}

/** Manager's answer to "what is my team doing today?" — one lane per
 *  member with that day's events in time order, plus a 7-day strip to
 *  hop across the week. Clicking an empty lane schedules for that
 *  member; everyone sees everyone (transparency), edits go through the
 *  same dialog / RLS as before. */
export function TeamView({ events, members, selectedDate, onSelectDate, onEventClick, onSlotClick }: TeamViewProps) {
  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const dayEventsByMember = useMemo(() => {
    const dayStr = selectedDate.toDateString();
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (new Date(ev.start_time).toDateString() !== dayStr) continue;
      const owner = ev.assigned_to || ev.user_id;
      if (!map[owner]) map[owner] = [];
      map[owner].push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    }
    return map;
  }, [events, selectedDate]);

  const shiftDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    onSelectDate(d);
  };

  const todayStr = new Date().toDateString();

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Week strip */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => shiftDay(-1)}
          aria-label="Previous day"
          className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {weekDays.map((d) => {
            const isSelected = d.toDateString() === selectedDate.toDateString();
            const isToday = d.toDateString() === todayStr;
            return (
              <button
                key={d.toISOString()}
                onClick={() => onSelectDate(d)}
                className={cn(
                  "flex flex-col items-center rounded-lg border px-1 py-1.5 transition-colors",
                  isSelected
                    ? "border-primary bg-primary/15 text-white"
                    : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white"
                )}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider">
                  {d.toLocaleDateString("en-IN", { weekday: "short" })}
                </span>
                <span className={cn("text-sm font-bold", isToday && !isSelected && "text-primary")}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => shiftDay(1)}
          aria-label="Next day"
          className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Member lanes */}
      <div className="flex-1 space-y-2 overflow-y-auto pr-1 min-h-0">
        {members.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-slate-500">
            No team members yet — invite your team from Settings.
          </div>
        ) : (
          members.map((m) => {
            const laneEvents = dayEventsByMember[m.user_id] || [];
            return (
              <div
                key={m.user_id}
                className="flex items-stretch gap-3 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3"
              >
                <div className="flex w-28 shrink-0 items-center gap-2">
                  {m.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
                      {memberInitials(m.full_name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{m.full_name || "Member"}</p>
                    <p className="text-[9px] uppercase tracking-wide text-slate-500">
                      {laneEvents.length > 0 ? `${laneEvents.length} scheduled` : "free"}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {laneEvents.length === 0 ? (
                    <button
                      onClick={() => onSlotClick(selectedDate, m.user_id)}
                      className="rounded-lg border border-dashed border-slate-800 px-3 py-1.5 text-[10px] text-slate-500 hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      + Schedule for {m.full_name?.split(" ")[0] || "member"}
                    </button>
                  ) : (
                    <>
                      {laneEvents.map((ev) => {
                        const meta = eventTypeMeta(ev.event_type);
                        return (
                          <button
                            key={ev.id}
                            onClick={() => onEventClick(ev)}
                            className={cn(
                              "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors",
                              meta.chip,
                              ev.status === "cancelled" && "line-through opacity-50",
                              ev.status === "completed" && "opacity-60"
                            )}
                          >
                            {ev.status === "completed" ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                            ) : (
                              <meta.icon className="h-3 w-3 shrink-0" />
                            )}
                            <span className="font-mono text-[9px] opacity-80">{formatTimeShort(ev.start_time)}</span>
                            <span className="truncate">{ev.title}</span>
                            {ev.contact?.name && <span className="hidden opacity-70 sm:inline truncate">· {ev.contact.name}</span>}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => onSlotClick(selectedDate, m.user_id)}
                        aria-label="Add event for member"
                        className="rounded-lg border border-dashed border-slate-800 px-2 py-1 text-[10px] text-slate-500 hover:border-primary/40 hover:text-primary transition-colors"
                      >
                        +
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
