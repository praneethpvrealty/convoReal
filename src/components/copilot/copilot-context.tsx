"use client";

// ============================================================
// Copilot shared state: the floating panel's open/close state and
// the guided-tour engine. Follows the TopupModalProvider pattern —
// one provider in the dashboard shell, one mounted overlay, many
// possible triggers via useCopilot().
//
// The tour engine is a small state machine per step:
//   waiting-for-route  → the step's page isn't active yet (we're
//                        mid-navigation after the previous click)
//   waiting-for-target → page active, polling for [data-tour=...]
//   showing            → spotlight visible, waiting for user action
// The provider lives in the shell, so tours survive route changes.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getTour, type Tour, type TourStep } from "@/lib/copilot/tours";

type TourStatus = "idle" | "waiting-for-route" | "waiting-for-target" | "showing";
type EndReason = "completed" | "aborted" | "lost" | "timeout";

interface CopilotContextValue {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  activeTour: Tour | null;
  stepIndex: number;
  tourStatus: TourStatus;
  /** Resolved spotlight target for the current step (when showing). */
  targetEl: HTMLElement | null;
  startTour: (tourId: string) => void;
  advance: () => void;
  endTour: (reason: EndReason) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

/** How long a step may wait for its route before the tour is "lost". */
const ROUTE_TIMEOUT_MS = 10_000;
/** How long a step may wait for its target element to render. */
const TARGET_TIMEOUT_MS = 8_000;
const TARGET_POLL_MS = 150;

function routeMatches(
  step: TourStep,
  pathname: string,
  search: URLSearchParams,
): boolean {
  const pathOk =
    step.routeMatch === "prefix"
      ? pathname.startsWith(step.route)
      : pathname === step.route;
  if (!pathOk) return false;
  if (step.query) {
    for (const [k, v] of Object.entries(step.query)) {
      if (search.get(k) !== v) return false;
    }
  }
  return true;
}

/** First visible element wins — some targets exist twice (e.g. the
 *  broadcasts page renders New Broadcast in both header and empty
 *  state) and hidden ones have a zero-size rect. */
function findTarget(target: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-tour="${target}"]`,
  );
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

export function CopilotProvider({
  children,
  openSidebar,
}: {
  children: ReactNode;
  /** Shell's setSidebarOpen(true) — mobile tour steps that target the
   *  sidebar must slide the drawer in first. */
  openSidebar: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [tourStatus, setTourStatus] = useState<TourStatus>("idle");
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);

  const endTour = useCallback((reason: EndReason) => {
    setActiveTour(null);
    setStepIndex(0);
    setTourStatus("idle");
    setTargetEl(null);
    if (reason === "completed") {
      toast.success("You did it! Tap the helper anytime for more guides. \u{1F389}");
    } else if (reason === "lost" || reason === "timeout") {
      toast("Tour ended — tap the helper button to restart it anytime.");
    }
  }, []);

  const advance = useCallback(() => {
    setActiveTour((tour) => {
      if (!tour) return tour;
      setStepIndex((i) => {
        if (i + 1 >= tour.steps.length) {
          // Defer endTour — we're inside two updaters here.
          queueMicrotask(() => endTour("completed"));
          return i;
        }
        return i + 1;
      });
      return tour;
    });
  }, [endTour]);

  const startTour = useCallback(
    (tourId: string) => {
      const tour = getTour(tourId);
      if (!tour) return;
      setPanelOpen(false);
      setActiveTour(tour);
      setStepIndex(0);
      setTourStatus("waiting-for-route");
      setTargetEl(null);
    },
    [],
  );

  // --- Per-step lifecycle -------------------------------------------
  // Re-runs whenever the step or the route changes. Owns the route
  // wait, the skip check, the drawer opening, and the target poll.
  useEffect(() => {
    if (!activeTour) return;
    const step = activeTour.steps[stepIndex];
    if (!step) return;

    const search = new URLSearchParams(searchParams.toString());

    // Skip nav steps when the user is already at the destination.
    if (step.skipIfNextRouteActive) {
      const next = activeTour.steps[stepIndex + 1];
      if (next && routeMatches(next, pathname, search)) {
        setStepIndex((i) => i + 1);
        return;
      }
    }

    if (!routeMatches(step, pathname, search)) {
      // A 'route-change' step advances when its route stops matching
      // (used as a fallback for in-page tab clicks).
      if (step.advanceOn === "route-change" && tourStatus === "showing") {
        advance();
        return;
      }
      setTourStatus("waiting-for-route");
      setTargetEl(null);
      const lostTimer = setTimeout(() => endTour("lost"), ROUTE_TIMEOUT_MS);
      return () => clearTimeout(lostTimer);
    }

    // Route is right — open the drawer for sidebar targets on mobile.
    if (step.requiresSidebar && window.innerWidth < 1024) {
      openSidebar();
    }

    // Poll for the target (150ms) + MutationObserver for instant
    // resolution when async page content lands.
    setTourStatus("waiting-for-target");
    setTargetEl(null);
    let done = false;
    const tryFind = () => {
      if (done) return;
      const el = findTarget(step.target);
      if (el) {
        done = true;
        cleanup();
        el.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
        setTargetEl(el);
        setTourStatus("showing");
      }
    };
    const interval = setInterval(tryFind, TARGET_POLL_MS);
    const observer = new MutationObserver(tryFind);
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(() => {
      if (!done) {
        cleanup();
        endTour("timeout");
      }
    }, TARGET_TIMEOUT_MS);
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      observer.disconnect();
    };
    tryFind();
    return cleanup;
    // tourStatus intentionally omitted: it's an output of this effect,
    // not an input — including it would re-run the poll on every
    // transition it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, stepIndex, pathname, searchParams, advance, endTour, openSidebar]);

  // --- click-target advancing ---------------------------------------
  // Capture-phase listener on document: survives React re-renders
  // replacing the node and fires before Link navigation starts.
  useEffect(() => {
    if (!activeTour || tourStatus !== "showing") return;
    const step = activeTour.steps[stepIndex];
    if (!step || step.advanceOn !== "click-target") return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(`[data-tour="${step.target}"]`)) advance();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [activeTour, stepIndex, tourStatus, advance]);

  // --- Escape aborts the tour ----------------------------------------
  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour("aborted");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTour, endTour]);

  const value = useMemo(
    () => ({
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      activeTour,
      stepIndex,
      tourStatus,
      targetEl,
      startTour,
      advance,
      endTour,
    }),
    [panelOpen, activeTour, stepIndex, tourStatus, targetEl, startTour, advance, endTour],
  );

  return (
    <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
  );
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) {
    throw new Error("useCopilot must be used within a CopilotProvider");
  }
  return ctx;
}
