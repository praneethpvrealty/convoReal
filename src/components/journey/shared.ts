/**
 * Shared constants + pure helpers for the Journey mind map.
 *
 * A "journey" is the funnel of one relationship: in buyer mode the
 * subject is a contact and the moving pieces are properties; in
 * property (seller) mode the subject is a property and the moving
 * pieces are contacts. Both directions read the same journey_items
 * rows — only the grouping column differs.
 */

import { differenceInCalendarDays } from "date-fns";

import type { JourneyItem, JourneyStage, JourneyStageKind } from "@/types";

export type JourneyMode = "buyer" | "property";

/** Seeded on first visit when the account has no stages yet —
 *  mirrors how the kanban seeds its default pipeline. Fully
 *  editable afterwards via the stage editor. */
export const DEFAULT_JOURNEY_STAGES: {
  name: string;
  color: string;
  kind: JourneyStageKind;
}[] = [
  { name: "Shared", color: "#3b82f6", kind: "prospecting" }, // blue
  { name: "Shortlisted", color: "#eab308", kind: "prospecting" }, // yellow
  { name: "Visited", color: "#f97316", kind: "prospecting" }, // orange
  { name: "Owner Meeting", color: "#8b5cf6", kind: "prospecting" }, // violet
  { name: "Token & Legal", color: "#06b6d4", kind: "closing" }, // cyan
  { name: "Registration", color: "#10b981", kind: "closing" }, // emerald
  { name: "Brokerage Paid", color: "#22c55e", kind: "won" }, // green
];

/** Stage kinds that put a relationship past the enquiry. A contact
 *  sitting on one of these is out of the follow-up radar: they are
 *  quiet on WhatsApp because the work moved to lawyers and the
 *  sub-registrar, not because they went cold. */
export const PAST_ENQUIRY_STAGE_KINDS: JourneyStageKind[] = ["closing", "won"];

export const JOURNEY_STAGE_KIND_META: Record<
  JourneyStageKind,
  { label: string; hint: string }
> = {
  prospecting: {
    label: "Prospecting",
    hint: "Still being worked as an enquiry — the follow-up radar chases it.",
  },
  closing: {
    label: "Closing",
    hint: "Token paid, legal or registration under way — no enquiry check-ins.",
  },
  won: { label: "Won", hint: "Deal completed." },
  lost: { label: "Lost", hint: "Deal died." },
};

export const JOURNEY_STAGE_KIND_ORDER: JourneyStageKind[] = [
  "prospecting",
  "closing",
  "won",
  "lost",
];

export type JourneyPriority = "high" | "medium" | "low";

/** Priority ladder for the overview — `rank` drives sorting (lower
 *  first), unrated journeys fall to the bottom with rank 3. */
export const JOURNEY_PRIORITY_META: Record<
  JourneyPriority,
  { label: string; rank: number; className: string; dot: string }
> = {
  high: {
    label: "High",
    rank: 0,
    className: "border-red-500/40 bg-red-500/10 text-red-300",
    dot: "bg-red-400",
  },
  medium: {
    label: "Medium",
    rank: 1,
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    rank: 2,
    className: "border-slate-600 bg-slate-800/60 text-slate-300",
    dot: "bg-slate-400",
  },
};

export const JOURNEY_PRIORITY_ORDER: JourneyPriority[] = [
  "high",
  "medium",
  "low",
];

export type JourneySort = "priority" | "recent" | "stage";

export const JOURNEY_SORT_LABELS: Record<JourneySort, string> = {
  priority: "Priority",
  recent: "Recent activity",
  stage: "Furthest stage",
};

export function priorityRank(priority: JourneyPriority | null): number {
  return priority ? JOURNEY_PRIORITY_META[priority].rank : 3;
}

/** Rankable shape — the overview's group, narrowed to what ordering
 *  actually reads. */
export interface RankableJourney {
  priority: JourneyPriority | null;
  furthestStageIdx: number;
  lastUpdated: string;
}

/**
 * Order journeys for the overview list. Every mode breaks ties the
 * same way (priority → furthest stage → most recently touched) so the
 * numbered rank stays stable when only the leading key changes.
 */
export function sortJourneys<T extends RankableJourney>(
  journeys: T[],
  sort: JourneySort,
): T[] {
  const byPriority = (a: T, b: T) =>
    priorityRank(a.priority) - priorityRank(b.priority);
  const byStage = (a: T, b: T) => b.furthestStageIdx - a.furthestStageIdx;
  const byRecent = (a: T, b: T) => b.lastUpdated.localeCompare(a.lastUpdated);
  const chain: Record<JourneySort, ((a: T, b: T) => number)[]> = {
    priority: [byPriority, byStage, byRecent],
    stage: [byStage, byPriority, byRecent],
    recent: [byRecent, byPriority, byStage],
  };
  return [...journeys].sort((a, b) => {
    for (const compare of chain[sort]) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  });
}

/** One-tap drop reasons — the free-text field stays available for
 *  anything not covered. */
export const QUICK_DROP_REASONS = [
  "Budget mismatch",
  "Location not suitable",
  "Didn't like the property",
  "Owner not negotiable",
  "Chose another property",
  "Legal issues",
  "Not responding",
];

/** Swatches offered by the stage editor. */
export const STAGE_COLOR_CHOICES = [
  "#3b82f6",
  "#eab308",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#22c55e",
  "#ec4899",
  "#ef4444",
  "#64748b",
];

/**
 * Navigate between journey views (overview ⇄ focused ⇄ mode tabs).
 *
 * These are all SAME-PATHNAME navigations (/journey with different
 * search params), which the app router swallows in production builds —
 * see src/lib/navigation.ts for the full story. All journey callers
 * are already on /journey, so this goes straight to the History API.
 */
export function navigateJourney(url: string) {
  window.history.pushState(null, "", url);
}

/** Human label for a planned step's expected date — "In 25 days",
 *  "Tomorrow", "Today", or "3 days overdue" once it slips. */
export function planEtaLabel(plannedAt: string): {
  text: string;
  overdue: boolean;
} {
  const days = differenceInCalendarDays(new Date(plannedAt), new Date());
  if (days > 1) return { text: `In ${days} days`, overdue: false };
  if (days === 1) return { text: "Tomorrow", overdue: false };
  if (days === 0) return { text: "Today", overdue: false };
  return {
    text: `${-days} day${days === -1 ? "" : "s"} overdue`,
    overdue: true,
  };
}

/** The item's valid planned-stage index: only meaningful for active
 *  items planning a stage AHEAD of where they are. -1 otherwise. */
export function plannedIndexOf(
  item: JourneyItem,
  stages: JourneyStage[],
): number {
  if (item.status !== "active" || !item.planned_stage_id) return -1;
  const planned = stages.findIndex((s) => s.id === item.planned_stage_id);
  return planned > stageIndexOf(item, stages) ? planned : -1;
}

/** Index of an item's furthest-reached stage in the ordered stage
 *  list; -1 when the stage was deleted out from under it (defensive —
 *  the editor blocks deleting stages with items). */
export function stageIndexOf(
  item: JourneyItem,
  stages: JourneyStage[],
): number {
  return stages.findIndex((s) => s.id === item.stage_id);
}

/** Row order on the canvas: furthest-travelled first so the map reads
 *  as a funnel (top rows reach the right edge, lower rows stop
 *  early), active before dropped at the same depth, then oldest
 *  first for stability. */
export function sortItemsForRows(
  items: JourneyItem[],
  stages: JourneyStage[],
): JourneyItem[] {
  return [...items].sort((a, b) => {
    const ai = stageIndexOf(a, stages);
    const bi = stageIndexOf(b, stages);
    if (ai !== bi) return bi - ai;
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}
