"use client";

// ============================================================
// The floating helper button (bottom-right on every dashboard page)
// plus the proactive-nudge speech bubble that appears above it.
// Hidden while a tour is showing — the overlay owns the screen then.
// Kill switch: set NEXT_PUBLIC_COPILOT_ENABLED=false to disable the
// whole copilot without a deploy rollback (defaults to on).
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { useCopilot } from "./copilot-context";
import { CopilotPanel } from "./copilot-panel";
import { useCopilotNudges } from "@/hooks/useCopilotNudges";

const COPILOT_ENABLED = process.env.NEXT_PUBLIC_COPILOT_ENABLED !== "false";
/** Auto-hide the bubble after this long (counts as shown, not
 *  dismissed-forever — the 24h global cooldown still applies). */
const NUDGE_AUTO_HIDE_MS = 20_000;

export function CopilotWidget() {
  const { panelOpen, openPanel, tourStatus, startTour } = useCopilot();
  const { nudge, dismiss, accept } = useCopilotNudges();
  const router = useRouter();
  const [bubbleVisible, setBubbleVisible] = useState(false);

  useEffect(() => {
    if (!nudge) {
      setBubbleVisible(false);
      return;
    }
    setBubbleVisible(true);
    const timer = setTimeout(() => dismiss(), NUDGE_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [nudge, dismiss]);

  if (!COPILOT_ENABLED) return null;
  if (tourStatus === "showing" || tourStatus === "waiting-for-target") {
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
      {nudge && bubbleVisible && !panelOpen && (
        <div className="fixed bottom-24 right-5 z-[60] w-[min(280px,calc(100vw-40px))] rounded-2xl rounded-br-sm border border-slate-700 bg-slate-950/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss tip"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white"
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
              className="mt-2.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
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
          onClick={openPanel}
          aria-label="Help & guides"
          data-tour="copilot-button"
          className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-650 text-white shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      <CopilotPanel />
    </>
  );
}
