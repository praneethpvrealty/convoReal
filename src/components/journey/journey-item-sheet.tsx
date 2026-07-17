"use client";

/**
 * Side sheet for one journey item (a contact×property pair).
 *
 * Opens when any node of the item is clicked on the canvas. Shows the
 * counterpart's summary (property in buyer mode, contact in seller
 * mode), a stage progress rail, the append-only event timeline, and
 * the actions that move the item along: advance, jump to a specific
 * stage, drop with a reason (quick chips + free text), reactivate,
 * remove. All writes happen in the parent — this sheet only collects
 * intent; it fetches nothing except the item's own timeline.
 */

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Ban,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  EyeOff,
  Home,
  MapPin,
  Phone,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatCurrencyShort } from "@/lib/currency-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  JourneyEvent,
  JourneyItem,
  JourneyStage,
} from "@/types";
import {
  planEtaLabel,
  QUICK_DROP_REASONS,
  stageIndexOf,
  type JourneyMode,
} from "./shared";
import { Input } from "@/components/ui/input";

const EVENT_LABELS: Record<JourneyEvent["event_type"], string> = {
  added: "Added to journey",
  advanced: "Advanced",
  moved: "Moved",
  dropped: "Dropped",
  reactivated: "Reactivated",
  hidden: "Hidden from map",
  unhidden: "Shown on map",
  planned: "Next step planned",
  plan_cleared: "Plan cleared",
};

export interface JourneyItemSheetProps {
  item: JourneyItem | null;
  mode: JourneyMode;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  onClose: () => void;
  onAdvance: (item: JourneyItem) => void;
  onMoveTo: (item: JourneyItem, stageId: string) => void;
  onDrop: (item: JourneyItem, reason: string) => void;
  onReactivate: (item: JourneyItem) => void;
  onRemove: (item: JourneyItem) => void;
  /** Tuck the item into the Captured tray without deleting anything. */
  onHide: (item: JourneyItem) => void;
  /** Schedule the expected next stage + date (ghost node on the map). */
  onPlan: (item: JourneyItem, stageId: string, dateISO: string) => void;
  onClearPlan: (item: JourneyItem) => void;
}

export function JourneyItemSheet({
  item,
  mode,
  stages,
  currency,
  canEdit,
  onClose,
  onAdvance,
  onMoveTo,
  onDrop,
  onReactivate,
  onRemove,
  onHide,
  onPlan,
  onClearPlan,
}: JourneyItemSheetProps) {
  const supabase = createClient();
  const open = item !== null;

  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [dropFormOpen, setDropFormOpen] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [planStageId, setPlanStageId] = useState("");
  const [planDate, setPlanDate] = useState("");

  // Reset transient state whenever a different item opens. Deferred
  // setter (matches the repo-wide pattern) so the reset doesn't
  // cascade a render inside the effect body.
  useEffect(() => {
    Promise.resolve().then(() => {
      setDropFormOpen(false);
      setDropReason("");
      setConfirmRemove(false);
      setPlanFormOpen(false);
      setPlanStageId("");
      setPlanDate("");
    });
  }, [item?.id]);

  // Timeline — refetches when the item row changes (stage moves bump
  // updated_at, so advancing from the sheet refreshes it live).
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    (async () => {
      setLoadingEvents(true);
      const { data } = await supabase
        .from("journey_events")
        .select("*")
        .eq("item_id", item.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setEvents((data ?? []) as JourneyEvent[]);
        setLoadingEvents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item, supabase]);

  const stageName = useMemo(() => {
    const map = new Map(stages.map((s) => [s.id, s.name]));
    return (id?: string | null) => (id ? map.get(id) ?? "?" : "?");
  }, [stages]);

  if (!item) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const dropped = item.status === "dropped";
  const reached = stageIndexOf(item, stages);
  const nextStage = stages[reached + 1];
  const title =
    mode === "buyer"
      ? item.property?.title ?? "Unknown property"
      : item.contact?.name ?? item.contact?.phone ?? "Unknown contact";

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-slate-800 bg-slate-950 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-slate-800 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-slate-100">
            {mode === "buyer" ? (
              <Home className="h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <span className="truncate">{title}</span>
            {dropped && (
              <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                Dropped
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-[11px] text-slate-400">
            {mode === "buyer" ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.property?.property_code && (
                  <span className="font-mono">{item.property.property_code}</span>
                )}
                {item.property?.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {item.property.location}
                  </span>
                )}
                {item.property?.price ? (
                  <span className="font-semibold text-emerald-300">
                    {formatCurrencyShort(item.property.price, currency)}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.contact?.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {item.contact.phone}
                  </span>
                )}
                {item.contact?.classification && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {item.contact.classification}
                  </span>
                )}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {/* Stage progress rail */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Journey progress
            </p>
            <div className="flex flex-col gap-1">
              {stages.map((s, idx) => {
                const passed = idx < reached;
                const current = idx === reached;
                const future = idx > reached;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                      current &&
                        (dropped ? "bg-red-500/10" : "bg-slate-800/70"),
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        future
                          ? "border-slate-700 bg-slate-900"
                          : "border-transparent",
                      )}
                      style={
                        future
                          ? undefined
                          : {
                              backgroundColor:
                                current && dropped ? "#ef4444" : s.color,
                            }
                      }
                    >
                      {passed && <Check className="h-2.5 w-2.5 text-slate-950" />}
                      {current && dropped && (
                        <Ban className="h-2.5 w-2.5 text-white" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "truncate",
                        future ? "text-slate-600" : "text-slate-200",
                        current && "font-bold",
                      )}
                    >
                      {s.name}
                    </span>
                    {current && (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {dropped ? "dropped here" : "current"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {dropped && item.drop_reason && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
                Drop reason
              </p>
              <p className="mt-1 text-xs text-slate-300">{item.drop_reason}</p>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="flex flex-col gap-2">
              {!dropped ? (
                <>
                  <div className="flex gap-2">
                    {nextStage && (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => onAdvance(item)}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Advance to {nextStage.name}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800">
                        Move to
                        <ChevronDown className="h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="border-slate-700 bg-slate-900"
                      >
                        {stages.map((s, idx) => (
                          <DropdownMenuItem
                            key={s.id}
                            disabled={idx === reached}
                            onClick={() => onMoveTo(item, s.id)}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Planned next step — the ghost node on the map. */}
                  {item.planned_stage_id && !planFormOpen ? (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-700 border-dashed bg-slate-900/60 px-3 py-2">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1 text-xs">
                        <span className="font-semibold text-slate-200">
                          Next: {stageName(item.planned_stage_id)}
                        </span>
                        {item.planned_at && (
                          <span
                            className={cn(
                              "ml-1.5",
                              planEtaLabel(item.planned_at).overdue
                                ? "font-semibold text-amber-400"
                                : "text-slate-400",
                            )}
                          >
                            {planEtaLabel(item.planned_at).text} ·{" "}
                            {new Date(item.planned_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanStageId(item.planned_stage_id ?? "");
                          setPlanDate(item.planned_at ?? "");
                          setPlanFormOpen(true);
                        }}
                        className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label="Clear planned step"
                        title="Clear planned step"
                        onClick={() => onClearPlan(item)}
                        className="shrink-0 text-slate-500 hover:text-red-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : !planFormOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setPlanStageId(stages[reached + 1]?.id ?? "");
                        setPlanDate("");
                        setPlanFormOpen(true);
                      }}
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Plan next step…
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Plan the next step
                      </p>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {stages.slice(reached + 1).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setPlanStageId(s.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                              planStageId === s.id
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500",
                            )}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                          </button>
                        ))}
                      </div>
                      <Input
                        type="date"
                        value={planDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setPlanDate(e.target.value)}
                        className="h-8 border-slate-700 bg-slate-950 text-xs"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPlanFormOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={!planStageId || !planDate}
                          onClick={() => {
                            onPlan(item, planStageId, planDate);
                            setPlanFormOpen(false);
                          }}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          Save plan
                        </Button>
                      </div>
                    </div>
                  )}

                  {!dropFormOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => setDropFormOpen(true)}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Drop at {stages[reached]?.name ?? "current stage"}…
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Why is this being dropped?
                      </p>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {QUICK_DROP_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setDropReason(r)}
                            className={cn(
                              "rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                              dropReason === r
                                ? "border-red-400 bg-red-500/15 text-red-200"
                                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500",
                            )}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        value={dropReason}
                        onChange={(e) => setDropReason(e.target.value)}
                        placeholder="Reason (shown on the map)"
                        className="min-h-[60px] border-slate-700 bg-slate-950 text-xs"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDropFormOpen(false);
                            setDropReason("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="bg-red-600 text-white hover:bg-red-500"
                          disabled={!dropReason.trim()}
                          onClick={() => {
                            onDrop(item, dropReason.trim());
                            setDropFormOpen(false);
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Drop
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Button size="sm" onClick={() => onReactivate(item)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reactivate at {stages[reached]?.name ?? "current stage"}
                </Button>
              )}
            </div>
          )}

          {/* Timeline */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Timeline
            </p>
            {loadingEvents ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-xs text-slate-600">No events yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {events.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-start gap-2 rounded-md border border-slate-800/80 bg-slate-900/40 px-2.5 py-2"
                  >
                    <Clock className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                    <div className="min-w-0 text-xs">
                      <span
                        className={cn(
                          "font-semibold",
                          ev.event_type === "dropped"
                            ? "text-red-300"
                            : ev.event_type === "reactivated"
                              ? "text-emerald-300"
                              : "text-slate-200",
                        )}
                      >
                        {EVENT_LABELS[ev.event_type]}
                      </span>
                      {(ev.event_type === "advanced" ||
                        ev.event_type === "moved" ||
                        ev.event_type === "planned") && (
                        <span className="text-slate-400">
                          {" "}
                          {stageName(ev.from_stage_id)} →{" "}
                          {stageName(ev.to_stage_id)}
                        </span>
                      )}
                      {ev.event_type === "added" && ev.to_stage_id && (
                        <span className="text-slate-400">
                          {" "}
                          at {stageName(ev.to_stage_id)}
                        </span>
                      )}
                      {ev.reason && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          “{ev.reason}”
                        </p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-600">
                        {formatDistanceToNow(new Date(ev.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {canEdit && (
          <SheetFooter className="border-t border-slate-800 px-5 py-3 sm:flex-row sm:justify-between">
            {!confirmRemove ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onHide(item)}
                  title="Keeps the record and history; the item waits in the Captured tray."
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide from map
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRemove(true)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from journey
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  Delete this branch and its history?
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 text-white hover:bg-red-500"
                  onClick={() => onRemove(item)}
                >
                  Remove
                </Button>
              </div>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
