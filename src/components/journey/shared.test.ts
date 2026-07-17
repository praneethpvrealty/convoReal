import { describe, expect, it, vi } from "vitest";

import type { JourneyItem, JourneyStage } from "@/types";
import {
  planEtaLabel,
  plannedIndexOf,
  sortItemsForRows,
  stageIndexOf,
} from "./shared";

function stage(id: string, position: number): JourneyStage {
  return {
    id,
    account_id: "acc",
    name: id,
    color: "#000",
    position,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

function item(
  id: string,
  stageId: string,
  status: "active" | "dropped",
  createdAt: string,
): JourneyItem {
  return {
    id,
    account_id: "acc",
    contact_id: "c1",
    property_id: `p-${id}`,
    stage_id: stageId,
    status,
    source: "manual",
    hidden: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const STAGES = [stage("shared", 0), stage("visited", 1), stage("token", 2)];

describe("stageIndexOf", () => {
  it("returns the stage's position in the ordered list", () => {
    expect(stageIndexOf(item("a", "visited", "active", "2026-01-01"), STAGES)).toBe(1);
  });

  it("returns -1 for a stage id that no longer exists", () => {
    expect(stageIndexOf(item("a", "gone", "active", "2026-01-01"), STAGES)).toBe(-1);
  });
});

describe("sortItemsForRows", () => {
  it("orders furthest-travelled first so the map reads as a funnel", () => {
    const rows = sortItemsForRows(
      [
        item("early", "shared", "active", "2026-01-01"),
        item("far", "token", "active", "2026-01-02"),
        item("mid", "visited", "active", "2026-01-03"),
      ],
      STAGES,
    );
    expect(rows.map((r) => r.id)).toEqual(["far", "mid", "early"]);
  });

  it("puts active before dropped at the same depth, then oldest first", () => {
    const rows = sortItemsForRows(
      [
        item("droppedOld", "visited", "dropped", "2026-01-01"),
        item("activeNew", "visited", "active", "2026-01-05"),
        item("activeOld", "visited", "active", "2026-01-02"),
      ],
      STAGES,
    );
    expect(rows.map((r) => r.id)).toEqual([
      "activeOld",
      "activeNew",
      "droppedOld",
    ]);
  });

  it("planEtaLabel renders future, today, and overdue labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T10:00:00Z"));
    expect(planEtaLabel("2026-08-11")).toEqual({ text: "In 25 days", overdue: false });
    expect(planEtaLabel("2026-07-18")).toEqual({ text: "Tomorrow", overdue: false });
    expect(planEtaLabel("2026-07-17")).toEqual({ text: "Today", overdue: false });
    expect(planEtaLabel("2026-07-14")).toEqual({ text: "3 days overdue", overdue: true });
    expect(planEtaLabel("2026-07-16")).toEqual({ text: "1 day overdue", overdue: true });
    vi.useRealTimers();
  });

  it("plannedIndexOf only accepts stages ahead of the frontier on active items", () => {
    const base = item("a", "visited", "active", "2026-01-01");
    expect(plannedIndexOf({ ...base, planned_stage_id: "token" }, STAGES)).toBe(2);
    // same/behind the frontier → invalid
    expect(plannedIndexOf({ ...base, planned_stage_id: "visited" }, STAGES)).toBe(-1);
    expect(plannedIndexOf({ ...base, planned_stage_id: "shared" }, STAGES)).toBe(-1);
    // dropped items never show a ghost
    expect(
      plannedIndexOf(
        { ...item("b", "visited", "dropped", "2026-01-01"), planned_stage_id: "token" },
        STAGES,
      ),
    ).toBe(-1);
    expect(plannedIndexOf(base, STAGES)).toBe(-1);
  });

  it("does not mutate the input array", () => {
    const input = [
      item("a", "shared", "active", "2026-01-01"),
      item("b", "token", "active", "2026-01-02"),
    ];
    const copy = [...input];
    sortItemsForRows(input, STAGES);
    expect(input).toEqual(copy);
  });
});
