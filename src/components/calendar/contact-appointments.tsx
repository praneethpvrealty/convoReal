"use client";

/**
 * All appointments involving one contact — upcoming first, recent
 * history below — with a "Schedule" button that opens the standard
 * ScheduleDialog pre-filled for them. Matches on both the primary
 * `contact_id` and membership in the multi-attendee `contact_ids`
 * array (migration 127), so meetings where the contact is one of
 * several attendees show too. Embedded by the Agents Directory's
 * SCHEDULE tab; reusable for any contact surface.
 */

import { useCallback, useEffect, useState } from "react";
import { format, isPast } from "date-fns";
import { CalendarDays, CalendarPlus, MapPin as MapPinIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import { ScheduleDialog } from "@/components/calendar/schedule-dialog";
import {
  EVENT_TYPES,
  type EventTypeKey,
} from "@/components/calendar/event-types";

interface AppointmentRow {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  location?: string | null;
  status: "scheduled" | "completed" | "cancelled";
  event_type?: EventTypeKey | null;
  property?: { id: string; title: string; property_code?: string | null } | null;
}

const STATUS_BADGES: Record<AppointmentRow["status"], string> = {
  scheduled: "bg-primary/10 text-primary",
  completed: "bg-emerald-500/10 text-emerald-300",
  cancelled: "bg-red-500/10 text-red-300",
};

export function ContactAppointments({ contactId }: { contactId: string }) {
  const supabase = createClient();
  const canEdit = useCan("send-messages");

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = useCallback(async () => {
    // Primary attendee OR one of several (contact_ids array contains).
    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id, title, start_time, end_time, location, status, event_type, property:properties(id, title, property_code)",
      )
      .or(`contact_id.eq.${contactId},contact_ids.cs.{${contactId}}`)
      .order("start_time", { ascending: false })
      .limit(50);
    if (error) console.error("Failed to load appointments:", error.message);
    setRows((data ?? []) as unknown as AppointmentRow[]);
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, [load]);

  const upcoming = rows
    .filter((r) => r.status === "scheduled" && !isPast(new Date(r.start_time)))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const history = rows.filter((r) => !upcoming.includes(r));

  const renderRow = (appt: AppointmentRow) => {
    const meta = EVENT_TYPES[appt.event_type ?? "other"] ?? EVENT_TYPES.other;
    const Icon = meta.icon;
    return (
      <div
        key={appt.id}
        className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 px-3.5 py-2.5"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
            meta.chip,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-white">
              {appt.title || meta.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                STATUS_BADGES[appt.status],
              )}
            >
              {appt.status}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span>
              {format(new Date(appt.start_time), "EEE, d MMM yyyy · h:mm a")}
            </span>
            {appt.location && (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3" />
                <span className="truncate">{appt.location}</span>
              </span>
            )}
            {appt.property && (
              <span className="truncate text-slate-500">
                {appt.property.property_code
                  ? `[${appt.property.property_code}] `
                  : ""}
                {appt.property.title}
              </span>
            )}
          </p>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <ConvoRealLoader size={20} label="Loading schedule" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Schedule</h3>
          <p className="mt-0.5 text-xs text-slate-450">
            Every appointment involving this contact — as the main attendee
            or one of several.
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setScheduleOpen(true)}
            className="h-8 gap-1.5 text-xs font-bold"
          >
            <CalendarPlus className="size-3.5" />
            Schedule
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mx-auto mt-4 max-w-lg rounded-xl border border-dashed border-slate-800 bg-slate-900/20 py-14 text-center">
          <CalendarDays className="mx-auto mb-3 size-10 text-slate-600 opacity-50" />
          <h4 className="mb-1 text-sm font-semibold text-white">
            Nothing scheduled yet
          </h4>
          <p className="mx-auto max-w-xs text-xs text-slate-400">
            Site visits, calls, and meetings involving this contact will show
            up here.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Upcoming ({upcoming.length})
              </p>
              <div className="space-y-2">{upcoming.map(renderRow)}</div>
            </div>
          )}
          {history.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                History ({history.length})
              </p>
              <div className="space-y-2">{history.map(renderRow)}</div>
            </div>
          )}
        </>
      )}

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        contactId={contactId}
        onSuccess={load}
      />
    </div>
  );
}
