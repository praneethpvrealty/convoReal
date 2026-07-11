"use client";

// ============================================================
// Spotlight overlay for guided tours. Renders only while a step is
// "showing": a dimmed screen with a cutout around the target (the
// box-shadow trick — the cutout div itself is pointer-events:none so
// the real element stays clickable through the hole), four blocker
// rects that swallow clicks outside the target, and a tooltip card.
//
// The app scrolls inside <main class="overflow-y-auto">, not the
// window — so rect tracking uses a capture-phase scroll listener to
// catch nested scrollers, plus resize + ResizeObserver.
// ============================================================

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useCopilot } from "./copilot-context";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;

export function TourOverlay() {
  const { activeTour, stepIndex, tourStatus, targetEl, advance, endTour } =
    useCopilot();
  const [rect, setRect] = useState<Rect | null>(null);

  const step =
    activeTour && tourStatus === "showing"
      ? activeTour.steps[stepIndex]
      : null;

  // Track the target's rect through scroll / resize / layout shifts.
  // A stale rect is harmless between steps: the component renders
  // null whenever there's no showing step, and the next measure
  // (first rAF after the target changes) corrects the position.
  useEffect(() => {
    if (!targetEl || !step) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = targetEl.getBoundingClientRect();
      setRect({
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(targetEl);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [targetEl, step]);

  // Move focus to the tooltip on each step for keyboard/screen-reader
  // users (the card carries an aria-live description).
  useEffect(() => {
    if (step && rect) {
      document.getElementById("copilot-tour-card")?.focus();
    }
  }, [step, rect, stepIndex]);

  if (!step || !rect || !activeTour) return null;

  const isClickStep = step.advanceOn === "click-target";
  const isLastStep = stepIndex === activeTour.steps.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 640;

  // Tooltip placement: below the target, flipped above when there's
  // more room there; bottom-docked on mobile.
  const CARD_W = 320;
  const spaceBelow = vh - (rect.top + rect.height);
  const placeAbove = spaceBelow < 220 && rect.top > spaceBelow;
  const cardLeft = Math.min(Math.max(rect.left, 12), Math.max(12, vw - CARD_W - 12));

  return (
    <div className="fixed inset-0 z-[70]" aria-hidden={false}>
      {/* Click blockers around the cutout — everything except the
          target swallows clicks. */}
      {[
        { top: 0, left: 0, width: vw, height: Math.max(0, rect.top) },
        {
          top: rect.top + rect.height,
          left: 0,
          width: vw,
          height: Math.max(0, vh - rect.top - rect.height),
        },
        { top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height },
        {
          top: rect.top,
          left: rect.left + rect.width,
          width: Math.max(0, vw - rect.left - rect.width),
          height: rect.height,
        },
      ].map((r, i) => (
        <div
          key={i}
          className="absolute"
          style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
        />
      ))}

      {/* Spotlight cutout — dims everything else, target stays live. */}
      <div
        className="absolute rounded-xl ring-2 ring-primary transition-all duration-200 pointer-events-none"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.72)",
        }}
      />

      {/* Tooltip card */}
      <div
        id="copilot-tour-card"
        role="dialog"
        aria-label={`Tour step ${stepIndex + 1} of ${activeTour.steps.length}: ${step.title}`}
        tabIndex={-1}
        className="absolute rounded-2xl border border-slate-700 bg-slate-950/95 backdrop-blur-xl p-4 shadow-2xl shadow-black/50 outline-none"
        style={
          mobile
            ? { left: 12, right: 12, bottom: 16 }
            : {
                left: cardLeft,
                width: CARD_W,
                ...(placeAbove
                  ? { bottom: vh - rect.top + 12 }
                  : { top: rect.top + rect.height + 12 }),
              }
        }
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary">
            Step {stepIndex + 1} of {activeTour.steps.length}
          </p>
          <button
            type="button"
            onClick={() => endTour("aborted")}
            aria-label="Exit tour"
            className="-m-1 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-1 text-sm font-bold text-white">{step.title}</h3>
        <p aria-live="polite" className="mt-1 text-sm leading-relaxed text-slate-300">
          {/* Strip the light **bold** markers used in step copy. */}
          {step.body.replace(/\*\*/g, "")}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {isClickStep ? (
            <span className="text-xs font-semibold text-primary motion-safe:animate-pulse">
              {"\u{1F446}"} Tap the highlighted button
            </span>
          ) : (
            <button
              type="button"
              onClick={advance}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              {isLastStep ? "Done" : "Next"}
            </button>
          )}
          <button
            type="button"
            onClick={() => endTour("aborted")}
            className="text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            Exit tour
          </button>
        </div>
      </div>
    </div>
  );
}
