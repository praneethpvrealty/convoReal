"use client";

/**
 * Journey mind map canvas.
 *
 * Renders one relationship as a left-to-right flow: the subject card
 * (buyer contact, or property in seller mode) fans out to every item
 * in the journey, and each item traces through the stage columns it
 * has passed — exactly the story the funnel tells verbally:
 *
 *   Supreeth ── Prop 5 ─┐ (dropped at Shared: budget mismatch)
 *            ── Prop 9 ──→ Shortlisted ──→ Visited ─┐ (dropped: …)
 *            ── Prop 15 ─→ Shortlisted ──→ Visited ──→ Owner Meeting → …
 *
 * Layout is computed, not persisted: each item owns a horizontal
 * swimlane (row), each stage owns a column, so an item's path reads
 * as a straight line that either keeps going or visibly stops.
 * Columns render only up to the furthest stage ANY item has reached —
 * later stages don't exist on the map yet, per spec.
 *
 * Node vocabulary:
 *   - subject   — the root card (contact or property)
 *   - stage     — column header pill with reached / dropped counts
 *   - item      — variant "trace" (compact pill for stages already
 *                 passed) or "frontier" (full card at the item's
 *                 current position; red + reason when dropped)
 *
 * All mutations live in the parent (journey-content) — this file is
 * pure presentation + hit-testing.
 */

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Ban,
  Building2,
  ChevronRight,
  Home,
  MapPin,
  Phone,
  Plus,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCurrencyShort } from "@/lib/currency-utils";
import type { Contact, JourneyItem, JourneyStage, Property } from "@/types";
import {
  sortItemsForRows,
  stageIndexOf,
  type JourneyMode,
} from "./shared";

// ── Layout constants ────────────────────────────────────────
const CARD_W = 240;
const CARD_H = 100;
const CHIP_W = 156;
const CHIP_H = 40;
const ROOT_W = 260;
const ROOT_H = 116;
const COL_W = 300; // column pitch (card + breathing room)
const ROW_H = 132; // swimlane pitch
const FIRST_COL_X = ROOT_W + 130;
const HEADER_Y = -96;

const colX = (stageIdx: number) => FIRST_COL_X + stageIdx * COL_W;

// ── Node payloads ───────────────────────────────────────────

interface SubjectData extends Record<string, unknown> {
  mode: JourneyMode;
  contact?: Contact | null;
  property?: Property | null;
  activeCount: number;
  droppedCount: number;
  currency: string;
}

interface StageHeaderData extends Record<string, unknown> {
  stage: JourneyStage;
  reachedCount: number;
  droppedCount: number;
}

interface ItemData extends Record<string, unknown> {
  item: JourneyItem;
  mode: JourneyMode;
  variant: "trace" | "frontier";
  stageColor: string;
  currency: string;
  /** Name of the stage after the item's current one — undefined at
   *  the last stage (nothing to advance into). */
  nextStageName?: string;
  onAdvance?: (item: JourneyItem) => void;
}

// ── Small display helpers ───────────────────────────────────

function itemTitle(item: JourneyItem, mode: JourneyMode): string {
  if (mode === "buyer") return item.property?.title ?? "Unknown property";
  return item.contact?.name ?? item.contact?.phone ?? "Unknown contact";
}

function itemCode(item: JourneyItem, mode: JourneyMode): string | null {
  if (mode === "buyer") return item.property?.property_code ?? null;
  return null;
}

// ── Custom nodes ────────────────────────────────────────────

const sourceHandleCls = "!h-2 !w-2 !border-0 !bg-slate-600";
const targetHandleCls = "!h-2 !w-2 !border-0 !bg-slate-600";

function SubjectNode({ data }: NodeProps) {
  const { mode, contact, property, activeCount, droppedCount, currency } =
    data as SubjectData;
  const isBuyer = mode === "buyer";
  const title = isBuyer
    ? contact?.name || contact?.phone || "Contact"
    : property?.title || "Property";
  return (
    <div
      className="rounded-xl border-2 border-primary/60 bg-gradient-to-br from-slate-900 to-slate-950 px-4 py-3 shadow-xl shadow-primary/10"
      style={{ width: ROOT_W, minHeight: ROOT_H }}
    >
      <Handle type="source" position={Position.Right} className={sourceHandleCls} />
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          {isBuyer ? (
            <UserRound className="h-4 w-4 text-primary" />
          ) : (
            <Building2 className="h-4 w-4 text-primary" />
          )}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white" title={title}>
            {title}
            {isBuyer && contact?.name_tag && (
              <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                {contact.name_tag}
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-slate-400">
            {isBuyer
              ? contact?.phone
              : [property?.property_code, property?.location]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>
      </div>
      {isBuyer && (contact?.areas_of_interest?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex items-start gap-1 text-[10px] text-slate-500">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-1">
            {contact!.areas_of_interest!.slice(0, 4).join(", ")}
          </span>
        </div>
      )}
      {!isBuyer && property && (
        <div className="mt-1.5 text-[11px] font-semibold text-emerald-300">
          {formatCurrencyShort(property.price, currency)}
        </div>
      )}
      <div className="mt-2 flex gap-2 text-[10px]">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300">
          {activeCount} active
        </span>
        {droppedCount > 0 && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-red-300">
            {droppedCount} dropped
          </span>
        )}
      </div>
    </div>
  );
}

function StageHeaderNode({ data }: NodeProps) {
  const { stage, reachedCount, droppedCount } = data as StageHeaderData;
  return (
    <div
      className="pointer-events-none flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/95 px-3.5 py-2 shadow-lg"
      style={{ width: CARD_W }}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: stage.color }}
      />
      <span className="truncate text-xs font-bold uppercase tracking-wider text-slate-200">
        {stage.name}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-semibold">
        <span className="text-slate-400">{reachedCount}</span>
        {droppedCount > 0 && (
          <span className="text-red-400" title="Dropped at this stage">
            −{droppedCount}
          </span>
        )}
      </span>
    </div>
  );
}

function ItemNode({ data, selected }: NodeProps) {
  const {
    item,
    mode,
    variant,
    stageColor,
    currency,
    nextStageName,
    onAdvance,
  } = data as ItemData;
  const dropped = item.status === "dropped";
  const title = itemTitle(item, mode);
  const code = itemCode(item, mode);

  if (variant === "trace") {
    // Compact pill for a stage the item has already passed through.
    return (
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-full border bg-slate-900/90 px-3 shadow transition-colors",
          dropped
            ? "border-slate-800 opacity-50"
            : "border-slate-700 hover:border-slate-500",
          selected && "!border-primary",
        )}
        style={{ width: CHIP_W, height: CHIP_H }}
      >
        <Handle type="target" position={Position.Left} className={targetHandleCls} />
        <Handle type="source" position={Position.Right} className={sourceHandleCls} />
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: stageColor }}
        />
        <span className="truncate text-[11px] font-medium text-slate-300">
          {code ?? title}
        </span>
      </div>
    );
  }

  // Frontier card — the item's current resting place.
  return (
    <div
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-slate-900/95 px-3 py-2.5 shadow-lg backdrop-blur transition-colors",
        dropped
          ? "border-red-500/50 hover:border-red-400/70"
          : "border-slate-700 hover:border-slate-500",
        selected && "!border-primary ring-1 ring-primary/40",
      )}
      style={{ width: CARD_W, minHeight: CARD_H }}
    >
      <Handle type="target" position={Position.Left} className={targetHandleCls} />
      {/* Stage accent bar */}
      <span
        className="absolute inset-y-2 left-0 w-1 rounded-r"
        style={{ backgroundColor: dropped ? "#ef4444" : stageColor }}
      />
      <div className="flex items-center gap-1.5 pl-1.5">
        {mode === "buyer" ? (
          <Home className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        ) : (
          <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        {code && (
          <span className="shrink-0 rounded border border-slate-800 bg-slate-950 px-1 py-0.5 font-mono text-[9px] font-bold text-slate-400">
            {code}
          </span>
        )}
        <span
          className={cn(
            "truncate text-xs font-bold",
            dropped ? "text-slate-400" : "text-white",
          )}
          title={title}
        >
          {title}
        </span>
      </div>
      <div className="mt-1 truncate pl-1.5 text-[10px] text-slate-500">
        {mode === "buyer" ? (
          <>
            {item.property?.location}
            {item.property?.price ? (
              <span className="ml-1.5 font-semibold text-emerald-300/90">
                {formatCurrencyShort(item.property.price, currency)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Phone className="h-2.5 w-2.5" />
            {item.contact?.phone}
            {item.contact?.lead_temp && (
              <span
                className={cn(
                  "ml-1 rounded px-1 py-px text-[9px] font-semibold",
                  item.contact.lead_temp === "HOT"
                    ? "bg-red-500/15 text-red-300"
                    : "bg-slate-800 text-slate-400",
                )}
              >
                {item.contact.lead_temp}
              </span>
            )}
          </span>
        )}
      </div>
      {dropped ? (
        <div className="mt-1.5 flex items-start gap-1 pl-1.5 text-[10px] text-red-300/90">
          <Ban className="mt-px h-3 w-3 shrink-0" />
          <span className="line-clamp-2">
            Dropped{item.drop_reason ? ` — ${item.drop_reason}` : ""}
          </span>
        </div>
      ) : (
        nextStageName &&
        onAdvance && (
          <button
            type="button"
            title={`Advance to ${nextStageName}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdvance(item);
            }}
            className="absolute -right-2.5 bottom-2.5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-300 opacity-0 shadow transition-all group-hover:opacity-100 hover:border-primary hover:bg-primary hover:text-white"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </div>
  );
}

const NODE_TYPES = {
  journeySubject: SubjectNode,
  journeyStage: StageHeaderNode,
  journeyItem: ItemNode,
};

// ── Canvas ──────────────────────────────────────────────────

export interface JourneyCanvasProps {
  mode: JourneyMode;
  contact?: Contact | null;
  property?: Property | null;
  stages: JourneyStage[];
  items: JourneyItem[];
  currency: string;
  canEdit: boolean;
  onSelectItem: (item: JourneyItem) => void;
  onAdvance: (item: JourneyItem) => void;
  onAddItems: () => void;
  selectedItemId?: string | null;
  /** Hidden items waiting in the Captured tray — surfaced as a hint
   *  when the canvas itself is empty. */
  capturedCount?: number;
  onOpenCaptured?: () => void;
  /** Container height utility classes — the focused view fills the
   *  viewport, embedded overview sections use a fixed band. */
  heightClass?: string;
}

export function JourneyCanvas(props: JourneyCanvasProps) {
  return (
    <ReactFlowProvider>
      <JourneyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function JourneyCanvasInner({
  mode,
  contact,
  property,
  stages,
  items,
  currency,
  canEdit,
  onSelectItem,
  onAdvance,
  onAddItems,
  selectedItemId,
  capturedCount = 0,
  onOpenCaptured,
  heightClass = "h-[calc(100vh-220px)] min-h-[480px]",
}: JourneyCanvasProps) {
  const reactFlow = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const rows = sortItemsForRows(items, stages);
    // Furthest column any item has reached — later stages stay off
    // the map entirely ("show only till the latest stage reached").
    const maxReached = rows.reduce(
      (max, it) => Math.max(max, stageIndexOf(it, stages)),
      -1,
    );

    const nodes: RfNode[] = [];
    const edges: RfEdge[] = [];

    const rowsHeight = Math.max(rows.length, 1) * ROW_H;
    const rootY = (rowsHeight - ROW_H) / 2 + (CARD_H - ROOT_H) / 2;

    nodes.push({
      id: "subject",
      type: "journeySubject",
      position: { x: 0, y: rootY },
      draggable: false,
      selectable: false,
      data: {
        mode,
        contact,
        property,
        activeCount: items.filter((i) => i.status === "active").length,
        droppedCount: items.filter((i) => i.status === "dropped").length,
        currency,
      } satisfies SubjectData,
    });

    // Stage column headers — only for columns in play.
    for (let s = 0; s <= maxReached; s++) {
      const stage = stages[s];
      if (!stage) continue;
      const reachedCount = rows.filter(
        (it) => stageIndexOf(it, stages) >= s,
      ).length;
      const droppedHere = rows.filter(
        (it) => it.status === "dropped" && stageIndexOf(it, stages) === s,
      ).length;
      nodes.push({
        id: `stage-${stage.id}`,
        type: "journeyStage",
        position: { x: colX(s), y: HEADER_Y },
        draggable: false,
        selectable: false,
        data: {
          stage,
          reachedCount,
          droppedCount: droppedHere,
        } satisfies StageHeaderData,
      });
    }

    rows.forEach((item, row) => {
      const reached = stageIndexOf(item, stages);
      if (reached < 0) return; // stage deleted out from under it — hidden, defensive
      const rowY = row * ROW_H;
      const dropped = item.status === "dropped";
      const nextStage = stages[reached + 1];

      for (let s = 0; s <= reached; s++) {
        const stage = stages[s];
        if (!stage) continue;
        const isFrontier = s === reached;
        const nodeId = `item-${item.id}@${s}`;
        nodes.push({
          id: nodeId,
          type: "journeyItem",
          position: {
            x: isFrontier ? colX(s) : colX(s) + (CARD_W - CHIP_W) / 2,
            y: isFrontier ? rowY : rowY + (CARD_H - CHIP_H) / 2,
          },
          draggable: false,
          selected: isFrontier && selectedItemId === item.id,
          data: {
            item,
            mode,
            variant: isFrontier ? "frontier" : "trace",
            stageColor: stage.color,
            currency,
            nextStageName:
              isFrontier && canEdit ? nextStage?.name : undefined,
            onAdvance: isFrontier && canEdit ? onAdvance : undefined,
          } satisfies ItemData,
        });

        const source = s === 0 ? "subject" : `item-${item.id}@${s - 1}`;
        const intoFrontier = isFrontier;
        edges.push({
          id: `e-${item.id}-${s}`,
          source,
          target: nodeId,
          animated: intoFrontier && !dropped,
          style: intoFrontier
            ? dropped
              ? { stroke: "#ef4444", strokeWidth: 1.5, strokeDasharray: "6 4", opacity: 0.7 }
              : { stroke: stage.color, strokeWidth: 2 }
            : {
                stroke: dropped ? "#334155" : "#475569",
                strokeWidth: 1.5,
                opacity: dropped ? 0.6 : 1,
              },
        });
      }
    });

    return { nodes, edges };
  }, [
    items,
    stages,
    mode,
    contact,
    property,
    currency,
    canEdit,
    onAdvance,
    selectedItemId,
  ]);

  // Re-frame when the journey's shape changes size (new subject, new
  // column unlocked, items added/removed) — not on every mutation.
  const shapeKey = `${mode}:${contact?.id ?? property?.id}:${items.length}:${nodes.length}`;
  useEffect(() => {
    const t = setTimeout(() => {
      reactFlow.fitView({ padding: 0.18, maxZoom: 1 });
    }, 50);
    return () => clearTimeout(t);
  }, [shapeKey, reactFlow]);

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950",
        heightClass,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_e, node) => {
          const data = node.data as Partial<ItemData>;
          if (node.type === "journeyItem" && data.item) {
            onSelectItem(data.item);
          }
        }}
        nodesConnectable={false}
        nodesDraggable={false}
        edgesFocusable={false}
        elementsSelectable={true}
        minZoom={0.15}
        maxZoom={1.5}
      >
        <Background gap={24} size={1} color="#1e293b" />
        <Controls
          className="!border-slate-700 !bg-slate-900 [&_button]:!border-slate-700 [&_button]:!bg-slate-900 [&_button:hover]:!bg-slate-800"
          showInteractive={false}
        />
        {/* Minimap only earns its pixels on maps big enough to get
            lost in — small journeys fit one screen, and on phones it
            just fought the floating AI widget for the corner. Nodes
            are tinted by status/stage so it doesn't read as an empty
            box on the dark background. */}
        {nodes.length >= 10 && (
          <MiniMap
            pannable
            zoomable
            position="top-right"
            style={{ width: 128, height: 88 }}
            nodeColor={(n) => {
              if (n.type === "journeySubject") return "#22c55e";
              if (n.type === "journeyStage") return "#1e293b";
              const d = n.data as Partial<ItemData>;
              return d.item?.status === "dropped"
                ? "#ef4444"
                : (d.stageColor ?? "#475569");
            }}
            maskColor="rgba(15, 23, 42, 0.75)"
            className="!hidden !rounded-lg !border !border-slate-700 !bg-slate-900 md:!block"
          />
        )}
        {/* Legend: only meaningful once something has been dropped;
            lives beside the zoom controls, out of the AI widget's
            corner. */}
        {items.some((i) => i.status === "dropped") && (
          <Panel position="bottom-left" className="!bottom-4 !left-16">
            <div className="flex items-center gap-2.5 rounded-md border border-slate-800 bg-slate-900/90 px-2 py-1 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Dropped
              </span>
            </div>
          </Panel>
        )}
        {items.length === 0 && (
          <Panel position="top-center" className="!top-1/3">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/80 px-8 py-6 text-center">
              <p className="text-sm text-slate-400">
                {mode === "buyer"
                  ? "No properties on this journey map yet."
                  : "No contacts on this journey map yet."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={onAddItems}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow transition-opacity hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {mode === "buyer" ? "Add properties" : "Add contacts"}
                  </button>
                )}
                {capturedCount > 0 && onOpenCaptured && (
                  <button
                    type="button"
                    onClick={onOpenCaptured}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 shadow transition-colors hover:bg-amber-500/20"
                  >
                    Review {capturedCount} captured share
                    {capturedCount === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
