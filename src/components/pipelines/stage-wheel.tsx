'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PipelineStage } from '@/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  initialWheelStageIndex,
  nearestWheelSlot,
  stageWheelMotion,
  wrapStageIndex,
} from '@/lib/pipelines/stage-wheel';

interface StageWheelProps {
  stages: PipelineStage[];
  dealCounts: number[];
  dragging: boolean;
  label: string;
  renderStage: (stage: PipelineStage) => ReactNode;
}

const MOTION_PROPERTIES = [
  '--stage-wheel-rotate-y',
  '--stage-wheel-translate-z',
  '--stage-wheel-scale',
  '--stage-wheel-opacity',
] as const;

export function StageWheel({
  stages,
  dealCounts,
  dragging,
  label,
  renderStage,
}: StageWheelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const openedFor = useRef<string | null>(null);
  const stageKey = stages.map((stage) => stage.id).join('|');

  const slots = useCallback(
    () =>
      Array.from(
        scrollerRef.current?.querySelectorAll<HTMLElement>(
          '[data-stage-wheel-slot]'
        ) ?? []
      ),
    []
  );

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current;
      const slot = slots()[index];
      if (!scroller || !slot) return;
      scroller.scrollTo({
        left: slot.offsetLeft + slot.offsetWidth / 2 - scroller.clientWidth / 2,
        behavior,
      });
    },
    [slots]
  );

  useLayoutEffect(() => {
    if (openedFor.current === stageKey || stages.length === 0) return;
    openedFor.current = stageKey;
    scrollToIndex(initialWheelStageIndex(dealCounts), 'instant');
  }, [stageKey, stages.length, dealCounts, scrollToIndex]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof window.matchMedia !== 'function') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const update = () => {
      frame = 0;
      const items = slots();
      if (items.length === 0) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const center = scrollerRect.left + scroller.clientWidth / 2;
      const centers = items.map((slot) => {
        const rect = slot.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      const pitch =
        items.length > 1
          ? Math.abs(items[1].offsetLeft - items[0].offsetLeft)
          : Math.max(items[0].offsetWidth, 1);
      setFocusIndex(nearestWheelSlot(centers, center));

      items.forEach((slot, index) => {
        if (reducedMotion.matches) {
          MOTION_PROPERTIES.forEach((property) =>
            slot.style.removeProperty(property)
          );
          return;
        }
        const motion = stageWheelMotion((centers[index] - center) / pitch);
        slot.style.setProperty(
          '--stage-wheel-rotate-y',
          `${motion.rotateYDegrees}deg`
        );
        slot.style.setProperty(
          '--stage-wheel-translate-z',
          `${motion.translateZPixels}px`
        );
        slot.style.setProperty('--stage-wheel-scale', `${motion.scale}`);
        slot.style.setProperty('--stage-wheel-opacity', `${motion.opacity}`);
      });
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reducedMotion.addEventListener('change', schedule);
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(schedule)
        : null;
    observer?.observe(scroller);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reducedMotion.removeEventListener('change', schedule);
      observer?.disconnect();
    };
  }, [slots, stageKey]);

  useEffect(() => {
    const dial = dialRef.current;
    const chip = dial?.children[focusIndex] as HTMLElement | undefined;
    if (!dial || !chip) return;
    const left = chip.offsetLeft;
    if (left < dial.scrollLeft) {
      dial.scrollTo({ left, behavior: 'smooth' });
    } else if (left + chip.offsetWidth > dial.scrollLeft + dial.clientWidth) {
      dial.scrollTo({
        left: left + chip.offsetWidth - dial.clientWidth,
        behavior: 'smooth',
      });
    }
  }, [focusIndex]);

  function turn(step: number) {
    scrollToIndex(wrapStageIndex(focusIndex + step, stages.length));
  }

  const focusedStage = stages[focusIndex];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => turn(-1)}
          aria-label="Previous stage"
          className="shrink-0 border border-slate-800 text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div
          ref={dialRef}
          role="tablist"
          aria-label={`Focus a stage in ${label}`}
          className="stage-wheel-dial relative flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
        >
          {stages.map((stage, index) => {
            const focused = index === focusIndex;
            return (
              <button
                key={stage.id}
                type="button"
                role="tab"
                aria-selected={focused}
                onClick={() => scrollToIndex(index)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  focused
                    ? 'border-primary/60 bg-primary/15 text-white'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                {stage.name}
                <span className="text-slate-500">{dealCounts[index] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden shrink-0 text-xs text-slate-500 tabular-nums sm:inline">
          {focusedStage ? `${focusIndex + 1} / ${stages.length}` : null}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => turn(1)}
          aria-label="Next stage"
          className="shrink-0 border border-slate-800 text-slate-300 hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={scrollerRef}
        data-flat={dragging ? 'true' : undefined}
        className="stage-wheel relative flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden py-2"
      >
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            data-stage-wheel-slot
            aria-current={index === focusIndex ? 'true' : undefined}
            className="stage-wheel-slot flex shrink-0 snap-center"
          >
            <div className="stage-wheel-face flex w-full">
              {renderStage(stage)}
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .stage-wheel {
          --stage-wheel-slot-width: min(74vw, 320px);
          padding-inline: max(
            0px,
            calc(50% - var(--stage-wheel-slot-width) / 2)
          );
          perspective: 1400px;
          scrollbar-width: none;
        }
        .stage-wheel::-webkit-scrollbar,
        .stage-wheel-dial::-webkit-scrollbar {
          display: none;
        }
        .stage-wheel-dial {
          scrollbar-width: none;
        }
        .stage-wheel-slot {
          width: var(--stage-wheel-slot-width);
          transform-style: preserve-3d;
          pointer-events: none;
        }
        .stage-wheel-face {
          pointer-events: auto;
          opacity: var(--stage-wheel-opacity, 1);
          transform: translateZ(var(--stage-wheel-translate-z, 0))
            rotateY(var(--stage-wheel-rotate-y, 0deg))
            scale(var(--stage-wheel-scale, 1));
          transform-origin: center center;
          backface-visibility: hidden;
          will-change: transform, opacity;
          transition: opacity 150ms ease-out;
        }
        .stage-wheel[data-flat] {
          scroll-snap-type: none;
        }
        .stage-wheel[data-flat] .stage-wheel-face {
          opacity: 1;
          transform: none;
          transition: none;
        }
      `}</style>
    </div>
  );
}
