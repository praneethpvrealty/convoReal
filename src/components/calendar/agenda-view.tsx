'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import type { DealDeadline } from '@/lib/deals/deadlines';
import { dealDateKey, dealDateLocalDay } from '@/lib/calendar/deal-dates';
import type { AppointmentStatus } from '@/lib/calendar/tasks-view';
import { CalendarEvent, TeamMember } from './event-types';
import { AppointmentTaskRow, DealDateTaskRow } from './tasks-list';

interface AgendaViewProps {
  events: CalendarEvent[];
  dealDates?: DealDeadline[];
  members: TeamMember[];
  canEdit: boolean;
  busyKey: string | null;
  onEventClick: (event: CalendarEvent) => void;
  onStatusChange: (event: CalendarEvent, status: AppointmentStatus) => void;
  onArchive: (event: CalendarEvent, archived: boolean) => void;
  onMilestoneDone: (dealDate: DealDeadline) => void;
}

type AgendaItem =
  | { kind: 'event'; at: number; event: CalendarEvent }
  | { kind: 'deal'; at: number; dealDate: DealDeadline };

function dayHeading(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const label = date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  if (date.toDateString() === today.toDateString()) return `Today · ${label}`;
  if (date.toDateString() === tomorrow.toDateString())
    return `Tomorrow · ${label}`;
  return label;
}

/** One scrollable, chronological list of everything scheduled —
 *  grouped by day, upcoming first, with finished/past events tucked
 *  behind a toggle so the working list stays clean. Its rows are the
 *  Tasks rows (CAL-010): the same Done / Cancel / Reopen and milestone
 *  tick in place, so the Agenda is the Tasks list of every day. */
export function AgendaView({
  events,
  dealDates = [],
  members,
  canEdit,
  busyKey,
  onEventClick,
  onStatusChange,
  onArchive,
  onMilestoneDone,
}: AgendaViewProps) {
  const [showPast, setShowPast] = useState(false);

  const { upcomingGroups, pastGroups } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // A deal date is date-only and sits at the top of its day, ahead
    // of the timed events that follow it.
    const items: AgendaItem[] = [
      ...dealDates.map((dealDate) => ({
        kind: 'deal' as const,
        at: dealDateLocalDay(dealDate.dueDate).getTime(),
        dealDate,
      })),
      ...events.map((event) => ({
        kind: 'event' as const,
        at: new Date(event.start_time).getTime(),
        event,
      })),
    ].sort((a, b) => a.at - b.at);

    const group = (list: AgendaItem[]) => {
      const map = new Map<string, { date: Date; items: AgendaItem[] }>();
      for (const item of list) {
        const d = new Date(item.at);
        const key = d.toDateString();
        let entry = map.get(key);
        if (!entry) {
          entry = { date: d, items: [] };
          map.set(key, entry);
        }
        entry.items.push(item);
      }
      return [...map.values()];
    };

    const upcoming = items.filter((item) => item.at >= startOfToday.getTime());
    const past = items
      .filter((item) => item.at < startOfToday.getTime())
      .reverse();

    return { upcomingGroups: group(upcoming), pastGroups: group(past) };
  }, [events, dealDates]);

  const memberFor = (ev: CalendarEvent) =>
    members.find((m) => m.user_id === (ev.assigned_to || ev.user_id));

  const renderItem = (item: AgendaItem) =>
    item.kind === 'deal' ? (
      <DealDateTaskRow
        key={dealDateKey(item.dealDate)}
        dealDate={item.dealDate}
        canEdit={canEdit}
        busy={busyKey === dealDateKey(item.dealDate)}
        onDone={onMilestoneDone}
      />
    ) : (
      <AppointmentTaskRow
        key={item.event.id}
        event={item.event}
        assignee={members.length > 1 ? memberFor(item.event) : undefined}
        canEdit={canEdit}
        busy={busyKey === item.event.id}
        onOpen={onEventClick}
        onStatusChange={onStatusChange}
        onArchive={onArchive}
      />
    );

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      {upcomingGroups.length === 0 && (
        <div className="flex h-40 flex-col items-center justify-center text-center text-slate-500">
          <p className="text-xs">
            Nothing scheduled yet — use the smart bar above to log your first
            event.
          </p>
        </div>
      )}

      {upcomingGroups.map((group) => (
        <div key={group.date.toDateString()}>
          <h3 className="sticky top-0 z-10 mb-1.5 bg-slate-900/95 py-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase backdrop-blur">
            {dayHeading(group.date)}
            <span className="ml-2 font-normal text-slate-600 normal-case">
              {group.items.length} item{group.items.length === 1 ? '' : 's'}
            </span>
          </h3>
          <div className="space-y-1.5">{group.items.map(renderItem)}</div>
        </div>
      ))}

      {pastGroups.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <button
            onClick={() => setShowPast(!showPast)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-white"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                showPast && 'rotate-180'
              )}
            />
            {showPast
              ? 'Hide past events'
              : `Show past events (${pastGroups.reduce((n, g) => n + g.items.length, 0)})`}
          </button>
          {showPast && (
            <div className="mt-3 space-y-4">
              {pastGroups.map((group) => (
                <div key={group.date.toDateString()}>
                  <h3 className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                    {dayHeading(group.date)}
                  </h3>
                  <div className="space-y-1.5">
                    {group.items.map(renderItem)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
