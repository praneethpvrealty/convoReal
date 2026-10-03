'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Deal, PipelineStage } from '@/types';
import { DealCard } from './deal-card';
import { StageWheel } from './stage-wheel';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isBrokeragePaidStage,
  pipelineOutcomeForStage,
  type PipelineOutcome,
} from '@/lib/pipelines/stage-semantics';
import type { BoardLayout } from '@/lib/pipelines/board-layout';
import {
  stageTotals,
  stageTotalsLabel,
  type StageTotals,
} from '@/lib/pipelines/deal-money';

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  currency?: string;
  layout: BoardLayout;
}

const OUTCOME_DIVIDERS: Partial<Record<PipelineOutcome, string>> = {
  successful: 'Closed won',
  lost: 'Lost',
};

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  currency = 'INR',
  layout,
}: PipelineBoardProps) {
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [expandedStageIds, setExpandedStageIds] = useState<Set<string>>(
    () => new Set()
  );

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const flatStages = useMemo(
    () =>
      (['active', 'successful', 'lost'] as const).flatMap((outcome) =>
        sortedStages.filter(
          (stage) => pipelineOutcomeForStage(stage) === outcome
        )
      ),
    [sortedStages]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);

    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) {
        bucket.push(deal);
      }
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor)
  );

  const activeDeal = activeDealId
    ? (deals.find((d) => d.id === activeDealId) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  function renderStage(stage: PipelineStage, stageLayout: StageLayout) {
    const stageDeals = dealsByStage.get(stage.id) ?? [];
    return (
      <StageColumn
        key={stage.id}
        stage={stage}
        deals={stageDeals}
        totals={stageTotals(stageDeals)}
        onAddDeal={onAddDeal}
        onEditDeal={onEditDeal}
        currency={currency}
        layout={stageLayout}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {layout === 'flat' ? (
        <div
          role="group"
          aria-label="Pipeline stages"
          className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:snap-none"
        >
          {flatStages.map((stage, index) => {
            const outcome = pipelineOutcomeForStage(stage);
            const divider =
              OUTCOME_DIVIDERS[outcome] &&
              flatStages.findIndex(
                (other) => pipelineOutcomeForStage(other) === outcome
              ) === index
                ? OUTCOME_DIVIDERS[outcome]
                : null;
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            return (
              <Fragment key={stage.id}>
                {divider && <OutcomeDivider label={divider} />}
                {stageDeals.length === 0 && !expandedStageIds.has(stage.id) ? (
                  <StageRail
                    stage={stage}
                    onAddDeal={onAddDeal}
                    onExpand={() =>
                      setExpandedStageIds((current) =>
                        new Set(current).add(stage.id)
                      )
                    }
                  />
                ) : (
                  renderStage(stage, 'flat')
                )}
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div className="space-y-5">
          {(
            [
              ['active', 'Active pipeline'],
              ['successful', 'Successful'],
              ['lost', 'Lost deals'],
            ] as const satisfies ReadonlyArray<
              readonly [PipelineOutcome, string]
            >
          ).map(([outcome, label]) => {
            const outcomeStages = sortedStages.filter(
              (stage) => pipelineOutcomeForStage(stage) === outcome
            );
            if (outcomeStages.length === 0) return null;
            return (
              <section key={outcome} aria-label={label}>
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
                    {label}
                  </h2>
                  <div className="h-px flex-1 bg-slate-800" />
                </div>
                {outcome !== 'lost' ? (
                  <StageWheel
                    stages={outcomeStages}
                    dealCounts={outcomeStages.map(
                      (stage) => dealsByStage.get(stage.id)?.length ?? 0
                    )}
                    dragging={activeDealId !== null}
                    label={label}
                    renderStage={(stage) => renderStage(stage, 'wheel')}
                  />
                ) : (
                  <div className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:snap-none">
                    {outcomeStages.map((stage) => renderStage(stage, 'row'))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
              currency={currency}
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
      `}</style>
    </DndContext>
  );
}

type StageLayout = 'row' | 'wheel' | 'flat';

function StageColumn({
  stage,
  deals,
  totals,
  onAddDeal,
  onEditDeal,
  currency,
  layout,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totals: StageTotals;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  currency: string;
  layout: StageLayout;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div
      className={cn(
        'flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4',
        layout === 'wheel' && 'w-full',
        layout === 'row' &&
          'w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none',
        layout === 'flat' &&
          'w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start lg:w-[300px]'
      )}
    >
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-white">
          {stage.name}
        </h3>
        <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
          {deals.length}
        </span>
      </div>
      <p className="text-xs text-slate-400">
        {stageTotalsLabel(totals, {
          paid: isBrokeragePaidStage(stage),
          currency,
        })}
      </p>

      <div
        ref={setNodeRef}
        data-stage-scroller
        className={cn(
          'mt-3 flex max-h-[min(60vh,560px)] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg transition-all',
          isOver &&
            'bg-primary/5 outline-primary outline outline-2 outline-offset-2 outline-dashed'
        )}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700 py-10 text-xs text-slate-500">
            Drop a deal here
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              onEdit={onEditDeal}
              currency={currency}
            />
          ))
        )}
      </div>

      {!isBrokeragePaidStage(stage) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddDeal(stage.id)}
          className="mt-3 w-full justify-start border border-dashed border-slate-700 bg-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Deal
        </Button>
      )}
    </div>
  );
}

function OutcomeDivider({ label }: { label: string }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className="flex shrink-0 flex-col items-center gap-2 py-2"
    >
      <div className="w-px flex-1 bg-slate-700" />
      <span
        aria-hidden
        className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase [writing-mode:vertical-rl]"
      >
        {label}
      </span>
      <div className="w-px flex-1 bg-slate-700" />
    </div>
  );
}

function StageRail({
  stage,
  onAddDeal,
  onExpand,
}: {
  stage: PipelineStage;
  onAddDeal: (stageId: string) => void;
  onExpand: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      data-stage-rail
      className={cn(
        'flex min-h-[240px] w-12 shrink-0 snap-start flex-col items-center rounded-xl border border-slate-800 bg-slate-900/60 pb-2 transition-all',
        isOver &&
          'bg-primary/5 outline-primary outline outline-2 outline-offset-2 outline-dashed'
      )}
    >
      <div
        className="h-[3px] w-full rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <button
        type="button"
        aria-expanded={false}
        aria-label={`Show ${stage.name}, no deals`}
        title={`Show ${stage.name}`}
        onClick={onExpand}
        className="flex min-h-0 flex-1 flex-col items-center gap-2 rounded-lg px-1 pt-3 text-slate-300 hover:text-white"
      >
        <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-300">
          0
        </span>
        <span className="min-h-0 truncate text-xs font-semibold [writing-mode:vertical-rl]">
          {stage.name}
        </span>
      </button>
      {!isBrokeragePaidStage(stage) && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Add deal to ${stage.name}`}
          onClick={() => onAddDeal(stage.id)}
          className="mt-2 border border-dashed border-slate-700 bg-transparent text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
        >
          <Plus className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  onEdit,
  currency,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal) => void;
  currency: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: isBrokeragePaidStage(stage),
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-deal-draggable
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
    >
      <DealCard deal={deal} stage={stage} onEdit={onEdit} currency={currency} />
    </div>
  );
}
