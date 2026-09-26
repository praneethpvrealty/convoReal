'use client';

// ============================================================
// The floating helper button (bottom-right on every dashboard page)
// plus the proactive-nudge speech bubble that appears above it.
// Drag the button anywhere; it snaps to the nearer edge and remembers
// where it was left.
// Hidden while a tour is showing — the overlay owns the screen then.
// Kill switch: set NEXT_PUBLIC_COPILOT_ENABLED=false to disable the
// whole copilot without a deploy rollback (defaults to on).
// ============================================================

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { useCopilot } from './copilot-context';
import { CopilotPanel } from './copilot-panel';
import { useCopilotNudges } from '@/hooks/useCopilotNudges';
import { useT } from '@/hooks/use-locale';
import { COPILOT_ENABLED } from '@/lib/copilot/config';
import { readStored, writeStored } from '@/lib/safe-storage';
import {
  LAUNCHER_EDGE_PX,
  LAUNCHER_STORAGE_KEY,
  isLauncherDrag,
  parseLauncherPlacement,
  snapLauncher,
  type LauncherPlacement,
} from '@/lib/copilot/launcher-placement';
/** Auto-hide the bubble after this long (counts as shown, not
 *  dismissed-forever — the 24h global cooldown still applies). */
const NUDGE_AUTO_HIDE_MS = 20_000;
const NUDGE_OFFSET_PX = 64;

const placementEvent = 'copilot-launcher-placement-change';
let memoryPlacement: string | null = null;

function subscribePlacement(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(placementEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(placementEvent, listener);
  };
}
const readPlacement = () => memoryPlacement ?? readStored(LAUNCHER_STORAGE_KEY);
const serverPlacement = () => null;

function savePlacement(placement: LauncherPlacement) {
  const value = JSON.stringify(placement);
  memoryPlacement = writeStored(LAUNCHER_STORAGE_KEY, value) ? null : value;
  window.dispatchEvent(new Event(placementEvent));
}

function sideStyle(placement: LauncherPlacement, bottom: number) {
  return placement.side === 'left'
    ? { bottom, left: LAUNCHER_EDGE_PX, right: 'auto' }
    : { bottom, right: LAUNCHER_EDGE_PX, left: 'auto' };
}

export function CopilotWidget() {
  const { panelOpen, openPanel, tourStatus, startTour } = useCopilot();
  const { nudge, dismiss, accept } = useCopilotNudges();
  const router = useRouter();
  const t = useT();
  const placement = parseLauncherPlacement(
    useSyncExternalStore(subscribePlacement, readPlacement, serverPlacement)
  );
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (drag || isLauncherDrag(dx, dy)) setDrag({ dx, dy });
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    dragStart.current = null;
    if (!drag) return;
    const next = snapLauncher(e.currentTarget.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    suppressClick.current = true;
    setDrag(null);
    savePlacement(next);
  };

  const onLauncherClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    openPanel();
  };

  // Auto-hide: dismissing clears the nudge in the hook, so the bubble
  // needs no visibility state of its own.
  useEffect(() => {
    if (!nudge) return;
    const timer = setTimeout(() => dismiss(), NUDGE_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [nudge, dismiss]);

  if (!COPILOT_ENABLED) return null;
  if (tourStatus === 'showing' || tourStatus === 'waiting-for-target') {
    return null;
  }

  const onAcceptNudge = () => {
    if (!nudge) return;
    const cta = nudge.cta;
    accept();
    if (cta?.tourId) startTour(cta.tourId);
    else if (cta?.href) router.push(cta.href);
  };

  return (
    <>
      {/* Nudge bubble */}
      {nudge && !panelOpen && (
        <div
          style={
            placement
              ? sideStyle(placement, placement.bottom + NUDGE_OFFSET_PX)
              : undefined
          }
          className={`fixed right-4 bottom-56 z-[60] w-[min(280px,calc(100vw-32px))] rounded-2xl ${placement?.side === 'left' ? 'rounded-bl-sm' : 'rounded-br-sm'} border border-slate-700 bg-slate-950/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur-xl md:bottom-32`}
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss tip"
            className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <p className="pr-5 text-sm leading-relaxed text-slate-200">
            {nudge.message}
          </p>
          {nudge.cta && (
            <button
              type="button"
              onClick={onAcceptNudge}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2.5 rounded-lg px-3 py-1.5 text-xs font-bold"
            >
              {nudge.cta.label}
            </button>
          )}
        </div>
      )}

      {/* Floating helper button */}
      {!panelOpen && (
        <button
          type="button"
          onClick={onLauncherClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStart.current = null;
            setDrag(null);
          }}
          aria-label={t('copilot.open')}
          title={t('copilot.assistant')}
          data-tour="copilot-button"
          style={{
            ...(placement ? sideStyle(placement, placement.bottom) : {}),
            ...(drag
              ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` }
              : {}),
          }}
          className={`from-primary to-indigo-650 shadow-primary/30 fixed right-4 bottom-40 z-[60] flex h-12 touch-none items-center justify-center gap-2 rounded-full bg-gradient-to-br px-4 text-sm font-bold text-white shadow-lg select-none md:bottom-16 ${drag ? 'cursor-grabbing' : 'transition-transform hover:scale-105 active:scale-95'}`}
        >
          <Sparkles className="h-5 w-5" />
          <span>{t('copilot.assistant')}</span>
        </button>
      )}

      <CopilotPanel />
    </>
  );
}
