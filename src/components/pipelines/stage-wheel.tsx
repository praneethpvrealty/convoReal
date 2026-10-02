'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useDndContext } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PipelineStage } from '@/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  initialWheelStageIndex,
  settleWheelPosition,
  stageWheelMotion,
  wheelSlotOffset,
  wheelStageIndexAt,
  wheelTurnTarget,
  wrapStageIndex,
} from '@/lib/pipelines/stage-wheel';

interface StageWheelProps {
  stages: PipelineStage[];
  dealCounts: number[];
  dragging: boolean;
  label: string;
  renderStage: (stage: PipelineStage) => ReactNode;
}

const SLOT_GAP = 12;
const GRAB_THRESHOLD = 6;
const WHEEL_SETTLE_MS = 140;
const EDGE_ZONE = 56;
const EDGE_TURN_COOLDOWN_MS = 700;

interface Grab {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  active: boolean;
}

export function StageWheel({
  stages,
  dealCounts,
  dragging,
  label,
  renderStage,
}: StageWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const frame = useRef(0);
  const flat = useRef(dragging);
  const reducedMotion = useRef(false);
  const openedFor = useRef<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(() =>
    initialWheelStageIndex(dealCounts)
  );
  const { measureDroppableContainers } = useDndContext();
  const count = stages.length;
  const stageKey = stages.map((stage) => stage.id).join('|');

  const pitch = useCallback(() => {
    const slot = ringRef.current?.querySelector<HTMLElement>(
      '[data-stage-wheel-slot]'
    );
    return slot ? slot.offsetWidth + SLOT_GAP : 1;
  }, []);

  const apply = useCallback(() => {
    const ring = ringRef.current;
    const rim = rimRef.current;
    if (!ring || !rim || count === 0) return;
    const step = pitch();
    const place = (element: HTMLElement, offset: number, opacity: number) => {
      element.style.setProperty('--stage-wheel-x', `${offset * step}px`);
      element.style.setProperty('--stage-wheel-opacity', `${opacity}`);
      element.style.setProperty(
        '--stage-wheel-order',
        `${100 - Math.round(Math.abs(offset) * 10)}`
      );
    };
    const faces = ring.querySelectorAll<HTMLElement>('[data-stage-wheel-slot]');
    faces.forEach((slot, index) => {
      const offset = wheelSlotOffset(index, position.current, count);
      const motion = stageWheelMotion(offset);
      const flatten = flat.current || reducedMotion.current;
      place(slot, offset, flat.current ? 1 : motion.opacity);
      slot.style.setProperty(
        '--stage-wheel-rotate-y',
        `${flatten ? 0 : motion.rotateYDegrees}deg`
      );
      slot.style.setProperty(
        '--stage-wheel-translate-z',
        `${flatten ? 0 : motion.translateZPixels}px`
      );
      slot.style.setProperty(
        '--stage-wheel-scale',
        `${flatten ? 1 : motion.scale}`
      );
    });
    rim
      .querySelectorAll<HTMLElement>('[data-stage-wheel-chip]')
      .forEach((chip, index) => {
        const offset = wheelSlotOffset(index, position.current, count);
        place(chip, offset, stageWheelMotion(offset).opacity);
      });
    setFocusIndex(wheelStageIndexAt(position.current, count));
  }, [count, pitch]);

  const stopTurn = useCallback(() => {
    if (frame.current) window.cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const stageIds = useRef<string[]>([]);
  const measure = useRef(measureDroppableContainers);
  useEffect(() => {
    stageIds.current = stages.map((stage) => stage.id);
    measure.current = measureDroppableContainers;
  }, [stages, measureDroppableContainers]);

  const turnTo = useCallback(
    (target: number, onDone?: () => void) => {
      stopTurn();
      const finish = () => {
        position.current = target;
        apply();
        onDone?.();
      };
      if (
        reducedMotion.current ||
        typeof window.requestAnimationFrame !== 'function'
      ) {
        finish();
        return;
      }
      const from = position.current;
      const start = performance.now();
      const duration = Math.min(600, 220 + Math.abs(target - from) * 160);
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        position.current = from + (target - from) * eased;
        apply();
        if (flat.current) measure.current(stageIds.current);
        if (t < 1) {
          frame.current = window.requestAnimationFrame(tick);
        } else {
          frame.current = 0;
          finish();
        }
      };
      frame.current = window.requestAnimationFrame(tick);
    },
    [apply, stopTurn]
  );

  const settle = useCallback(
    (target: number) => {
      turnTo(target, () => {
        position.current = wrapStageIndex(target, count);
        apply();
        if (flat.current) measure.current(stageIds.current);
      });
    },
    [apply, count, turnTo]
  );

  useLayoutEffect(() => {
    if (typeof window.matchMedia === 'function') {
      reducedMotion.current = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
    }
    if (openedFor.current !== stageKey) {
      openedFor.current = stageKey;
      stopTurn();
      position.current = initialWheelStageIndex(dealCounts);
    }
    if (dragging && !flat.current) {
      stopTurn();
      position.current = Math.round(position.current);
    }
    flat.current = dragging;
    apply();
  }, [stageKey, dealCounts, dragging, apply, stopTurn]);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const reduced =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const onReducedChange = () => {
      reducedMotion.current = reduced?.matches ?? false;
      apply();
    };
    window.addEventListener('resize', apply);
    reduced?.addEventListener('change', onReducedChange);
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(ring);
    return () => {
      window.removeEventListener('resize', apply);
      reduced?.removeEventListener('change', onReducedChange);
      observer?.disconnect();
      stopTurn();
    };
  }, [apply, stopTurn]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || count < 2) return;
    let grab: Grab | null = null;
    let suppressClick = false;
    let wheelTimer = 0;

    const onPointerDown = (event: PointerEvent) => {
      suppressClick = false;
      if (event.button !== 0 || flat.current) return;
      const target = event.target as Element | null;
      if (
        target?.closest(
          '[data-deal-draggable], input, textarea, select, a, [data-stage-wheel-ignore]'
        )
      ) {
        return;
      }
      grab = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: position.current,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        active: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!grab || event.pointerId !== grab.pointerId || flat.current) return;
      const dx = event.clientX - grab.startX;
      const dy = event.clientY - grab.startY;
      if (!grab.active) {
        if (Math.abs(dx) < GRAB_THRESHOLD) {
          if (Math.abs(dy) >= GRAB_THRESHOLD) grab = null;
          return;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          grab = null;
          return;
        }
        grab.active = true;
        grab.startPosition = position.current;
        stopTurn();
        window.clearTimeout(wheelTimer);
        suppressClick = true;
        root.dataset.grabbing = 'true';
        try {
          root.setPointerCapture(event.pointerId);
        } catch {}
      }
      event.preventDefault();
      const step = pitch();
      position.current = grab.startPosition - dx / step;
      const elapsed = event.timeStamp - grab.lastTime;
      if (elapsed > 0) {
        const instant = -(event.clientX - grab.lastX) / step / elapsed;
        grab.velocity = grab.velocity * 0.4 + instant * 0.6;
      }
      grab.lastX = event.clientX;
      grab.lastTime = event.timeStamp;
      apply();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!grab || event.pointerId !== grab.pointerId) return;
      const released = grab;
      grab = null;
      if (!released.active) return;
      delete root.dataset.grabbing;
      if (root.hasPointerCapture?.(event.pointerId)) {
        root.releasePointerCapture(event.pointerId);
      }
      const velocity =
        event.timeStamp - released.lastTime > 80 ? 0 : released.velocity;
      settle(settleWheelPosition(position.current, velocity));
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onWheel = (event: WheelEvent) => {
      if (flat.current) return;
      const sideways = event.shiftKey && event.deltaX === 0;
      const across = sideways ? event.deltaY : event.deltaX;
      const along = sideways ? 0 : event.deltaY;
      if (Math.abs(across) <= Math.abs(along)) return;
      const step = pitch();
      const dx =
        event.deltaMode === 1
          ? across * 16
          : event.deltaMode === 2
            ? across * step
            : across;
      if (dx === 0) return;
      event.preventDefault();
      stopTurn();
      window.clearTimeout(wheelTimer);
      position.current += dx / step;
      apply();
      wheelTimer = window.setTimeout(
        () => settle(settleWheelPosition(position.current)),
        WHEEL_SETTLE_MS
      );
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('click', onClick, true);
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.clearTimeout(wheelTimer);
      delete root.dataset.grabbing;
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerUp);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('wheel', onWheel);
    };
  }, [apply, count, pitch, settle, stopTurn]);

  useEffect(() => {
    if (!dragging || count < 2) return;
    let lastTurn = 0;
    let edgeStep = 0;
    const turnAtEdge = () => {
      if (!edgeStep || frame.current) return;
      if (performance.now() - lastTurn < EDGE_TURN_COOLDOWN_MS) return;
      lastTurn = performance.now();
      settle(Math.round(position.current) + edgeStep);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = ringRef.current?.getBoundingClientRect();
      edgeStep =
        !rect || event.clientY < rect.top || event.clientY > rect.bottom
          ? 0
          : event.clientX < rect.left + EDGE_ZONE
            ? -1
            : event.clientX > rect.right - EDGE_ZONE
              ? 1
              : 0;
      turnAtEdge();
    };
    const timer = window.setInterval(turnAtEdge, 100);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [dragging, count, settle]);

  function turn(step: number) {
    settle(Math.round(position.current) + step);
  }

  function focusStage(index: number) {
    settle(wheelTurnTarget(position.current, index, count));
  }

  function onRimKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      turn(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      turn(1);
    }
  }

  const focusedStage = stages[focusIndex];

  return (
    <div
      ref={rootRef}
      className="stage-wheel space-y-3"
      data-flat={dragging ? 'true' : undefined}
    >
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
          ref={rimRef}
          role="tablist"
          aria-label={`Focus a stage in ${label}`}
          onKeyDown={onRimKeyDown}
          className="stage-wheel-rim relative min-w-0 flex-1 py-0.5"
        >
          {stages.map((stage, index) => {
            const focused = index === focusIndex;
            return (
              <button
                key={stage.id}
                type="button"
                role="tab"
                data-stage-wheel-chip
                aria-selected={focused}
                onClick={() => focusStage(index)}
                className={cn(
                  'stage-wheel-chip flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                  focused
                    ? 'border-primary/60 bg-primary/15 text-white'
                    : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="truncate">{stage.name}</span>
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

      <div ref={ringRef} className="stage-wheel-ring relative py-2">
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            data-stage-wheel-slot
            aria-current={index === focusIndex ? 'true' : undefined}
            className="stage-wheel-slot flex"
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
          touch-action: pan-y;
        }
        .stage-wheel[data-grabbing] {
          cursor: grabbing;
          user-select: none;
          -webkit-user-select: none;
        }
        .stage-wheel-rim,
        .stage-wheel-ring {
          display: grid;
          overflow-x: clip;
          overflow-y: visible;
          cursor: grab;
        }
        .stage-wheel[data-grabbing] .stage-wheel-rim,
        .stage-wheel[data-grabbing] .stage-wheel-ring {
          cursor: grabbing;
        }
        .stage-wheel[data-flat] .stage-wheel-rim,
        .stage-wheel[data-flat] .stage-wheel-ring {
          cursor: default;
        }
        .stage-wheel-ring {
          perspective: 1400px;
        }
        .stage-wheel-chip,
        .stage-wheel-slot {
          grid-area: 1 / 1;
          justify-self: center;
          align-self: start;
          position: relative;
          z-index: var(--stage-wheel-order, 1);
          transform: translateX(var(--stage-wheel-x, 0px));
          will-change: transform;
        }
        .stage-wheel-chip {
          opacity: var(--stage-wheel-opacity, 1);
        }
        .stage-wheel-slot {
          width: var(--stage-wheel-slot-width);
          transform-style: preserve-3d;
        }
        .stage-wheel-face {
          opacity: var(--stage-wheel-opacity, 1);
          transform: translateZ(var(--stage-wheel-translate-z, 0px))
            rotateY(var(--stage-wheel-rotate-y, 0deg))
            scale(var(--stage-wheel-scale, 1));
          transform-origin: center center;
          backface-visibility: hidden;
          will-change: transform, opacity;
        }
      `}</style>
    </div>
  );
}
