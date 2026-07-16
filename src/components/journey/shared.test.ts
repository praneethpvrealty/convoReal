import { describe, expect, it } from "vitest";

import type { JourneyItem, JourneyStage } from "@/types";
import { sortItemsForRows, stageIndexOf } from "./shared";

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
