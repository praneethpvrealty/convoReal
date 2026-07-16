/**
 * Shared constants + pure helpers for the Journey mind map.
 *
 * A "journey" is the funnel of one relationship: in buyer mode the
 * subject is a contact and the moving pieces are properties; in
 * property (seller) mode the subject is a property and the moving
 * pieces are contacts. Both directions read the same journey_items
 * rows — only the grouping column differs.
 */

import type { JourneyItem, JourneyStage } from "@/types";

export type JourneyMode = "buyer" | "property";

/** Seeded on first visit when the account has no stages yet —
 *  mirrors how the kanban seeds its default pipeline. Fully
 *  editable afterwards via the stage editor. */
export const DEFAULT_JOURNEY_STAGES = [
  { name: "Shared", color: "#3b82f6" }, // blue
  { name: "Shortlisted", color: "#eab308" }, // yellow
  { name: "Visited", color: "#f97316" }, // orange
  { name: "Owner Meeting", color: "#8b5cf6" }, // violet
  { name: "Token & Legal", color: "#06b6d4" }, // cyan
  { name: "Registration", color: "#10b981" }, // emerald
  { name: "Brokerage Paid", color: "#22c55e" }, // green
];

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
