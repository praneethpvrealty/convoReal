'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { deadlineLabel, type DealDeadline } from '@/lib/deals/deadlines';
import {
  DEAL_DATE_KIND_LABELS,
  dealDateChipLabel,
  dealDateHref,
  dealDateKey,
} from '@/lib/calendar/deal-dates';
import { isArchivedAppointment } from '@/lib/calendar/tasks-view';
import { foldCellItems, moreLabel } from '@/lib/calendar/month-cell';
import {
  ARCHIVED_EVENT_CHIP,
  CalendarEvent,
  DEAL_DATE_META,
  TeamMember,
  eventTypeMeta,
  formatTimeShort,
  memberInitials,
} from './event-types';

type CellItem =
  | { kind: 'appointment'; key: string; appointment: CalendarEvent }
  | { kind: 'deal'; key: string; dealDate: DealDeadline };

interface MonthCellProps {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  appointments: CalendarEvent[];
  dealDates: DealDeadline[];
  memberByUserId: Record<string, TeamMember>;
  showAssignee: boolean;
  onSelectDay: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

interface ChipProps {
  item: CellItem;
  memberByUserId: Record<string, TeamMember>;
  showAssignee: boolean;
  showTime?: boolean;
  onEventClick: (event: CalendarEvent) => void;
}

function CellChip({
  item,
  memberByUserId,
  showAssignee,
  showTime = false,
  onEventClick,
}: ChipProps) {
  if (item.kind === 'deal') {
    const d = item.dealDate;
    return (
      <Link
        href={dealDateHref(d.dealId)}
        onClick={(e) => e.stopPropagation()}
        title={`${DEAL_DATE_KIND_LABELS[d.kind]} · ${d.subject} · ${deadlineLabel(d.daysLeft)}`}
        className={cn(
          'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-snug transition-colors',
          DEAL_DATE_META.chip,
          d.urgency === 'overdue' && 'border-rose-500/50'
        )}
      >
        <DEAL_DATE_META.icon className="h-2.5 w-2.5 shrink-0" />
        <span className="flex-1 truncate">{dealDateChipLabel(d)}</span>
      </Link>
    );
  }
  const appt = item.appointment;
  const meta = eventTypeMeta(appt.event_type);
  const assignee = memberByUserId[appt.assigned_to || appt.user_id];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onEventClick(appt);
      }}
      title={appt.title}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[11px] leading-snug transition-colors',
        meta.chip,
        appt.status === 'completed' && 'opacity-60',
        appt.status === 'cancelled' && 'line-through opacity-50',
        isArchivedAppointment(appt) && ARCHIVED_EVENT_CHIP
      )}
    >
      <meta.icon className="h-2.5 w-2.5 shrink-0" />
      {showTime && (
        <span className="shrink-0 text-[11px] opacity-80">
          {formatTimeShort(appt.start_time)}
        </span>
      )}
      <span className="flex-1 truncate">{appt.title}</span>
      {appt.reschedule_requested_at && (
        <RefreshCcw
          className="h-2.5 w-2.5 shrink-0 text-amber-400"
          aria-label="Reschedule requested"
        />
      )}
      {!appt.reschedule_requested_at && appt.client_confirmed_at && (
        <CheckCircle
          className="h-2.5 w-2.5 shrink-0 text-emerald-400"
          aria-label="Client confirmed"
        />
      )}
      {showAssignee && assignee && (
        <span
          className="shrink-0 rounded bg-slate-900/70 px-1 text-[10px] font-bold"
          title={assignee.full_name}
        >
          {memberInitials(assignee.full_name)}
        </span>
      )}
    </button>
  );
}

/** One day of the month grid. A busy day never scrolls inside its own
 *  cell: the first chips show and the rest fold behind "+N more", which
 *  opens the whole day in a popover. */
export function MonthCell({
  day,
  date,
  isCurrentMonth,
  isToday,
  appointments,
  dealDates,
  memberByUserId,
  showAssignee,
  onSelectDay,
  onEventClick,
}: MonthCellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const items: CellItem[] = [
    ...appointments.map((appointment) => ({
      kind: 'appointment' as const,
      key: appointment.id,
      appointment,
    })),
    ...dealDates.map((dealDate) => ({
      kind: 'deal' as const,
      key: dealDateKey(dealDate),
      dealDate,
    })),
  ];
  const { shown, hiddenCount } = foldCellItems(items);
  const dayLabel = date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Schedule on ${dayLabel}`}
      onClick={() => onSelectDay(date)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectDay(date);
        }
      }}
      className={cn(
        'group focus-visible:ring-primary/60 relative flex min-h-[88px] cursor-pointer flex-col bg-slate-950 p-2 transition-colors hover:bg-slate-900/60 focus-visible:ring-1 focus-visible:outline-none',
        !isCurrentMonth && 'opacity-45'
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
            isToday
              ? 'bg-primary text-primary-foreground font-black'
              : 'text-slate-400 group-hover:text-white'
          )}
        >
          {day}
        </span>
        <span
          aria-hidden="true"
          className="text-[11px] font-semibold text-slate-600 opacity-0 transition-opacity group-hover:opacity-100"
        >
          +
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {shown.map((item) => (
          <CellChip
            key={item.key}
            item={item}
            memberByUserId={memberByUserId}
            showAssignee={showAssignee}
            onEventClick={onEventClick}
          />
        ))}
        {hiddenCount > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger
              onClick={(e) => e.stopPropagation()}
              aria-label={`${moreLabel(hiddenCount)} on ${dayLabel}`}
              className="self-start rounded px-1 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              {moreLabel(hiddenCount)}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={6}
              className="w-72 gap-0 border border-slate-800 bg-slate-900 p-0"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                  <span className="text-xs font-bold text-white">
                    {dayLabel}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {items.length} items
                  </span>
                </div>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto p-2">
                  {items.map((item) => (
                    <CellChip
                      key={item.key}
                      item={item}
                      memberByUserId={memberByUserId}
                      showAssignee={showAssignee}
                      showTime
                      onEventClick={(event) => {
                        setMoreOpen(false);
                        onEventClick(event);
                      }}
                    />
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
