"use client";

// ============================================================
// Proactive-nudge picker. Fetches /api/copilot/nudges once per
// browser session (8s after mount, so it never competes with page
// load), then shows at most ONE nudge respecting two cooldowns kept
// in per-account localStorage (same pattern as onboarding_dismissed):
//   copilot_nudge_last_shown_<accountId>  — max 1 bubble per 24h
//   copilot_nudge_seen_<accountId>        — per-nudge 7-day dedupe
// Trade-off: localStorage is per-device, so phone + laptop can each
// show the same nudge once. Acceptable for v1; a jsonb column on
// profiles would fix it if it ever grates.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { CopilotNudge } from "@/lib/copilot/nudges";

const FETCH_DELAY_MS = 8_000;
const GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PER_NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_FETCH_KEY = "copilot_nudges_fetched";

function readSeen(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

export function useCopilotNudges(): {
  nudge: CopilotNudge | null;
  /** User closed the bubble — start both cooldowns. */
  dismiss: () => void;
  /** User tapped the CTA — same cooldowns, caller runs the action. */
  accept: () => void;
} {
  const { profile } = useAuth();
  const accountId = profile?.account_id as string | undefined;
  const [nudge, setNudge] = useState<CopilotNudge | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const lastShownKey = `copilot_nudge_last_shown_${accountId}`;
    const seenKey = `copilot_nudge_seen_${accountId}`;

    const lastShown = Number(localStorage.getItem(lastShownKey) ?? 0);
    if (Date.now() - lastShown < GLOBAL_COOLDOWN_MS) return;
    if (sessionStorage.getItem(SESSION_FETCH_KEY)) return;

    const timer = setTimeout(async () => {
      sessionStorage.setItem(SESSION_FETCH_KEY, "1");
      try {
        const res = await fetch("/api/copilot/nudges");
        if (!res.ok) return;
        const data: { nudges: CopilotNudge[] } = await res.json();
        const seen = readSeen(seenKey);
        const pick = data.nudges.find(
          (n) => Date.now() - (seen[n.id] ?? 0) > PER_NUDGE_COOLDOWN_MS,
        );
        if (pick) setNudge(pick);
      } catch {
        // Nudges are best-effort — never surface an error for them.
      }
    }, FETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [accountId]);

  const markSeen = useCallback(() => {
    if (!accountId || !nudge) return;
    localStorage.setItem(
      `copilot_nudge_last_shown_${accountId}`,
      String(Date.now()),
    );
    const seenKey = `copilot_nudge_seen_${accountId}`;
    const seen = readSeen(seenKey);
    seen[nudge.id] = Date.now();
    localStorage.setItem(seenKey, JSON.stringify(seen));
    setNudge(null);
  }, [accountId, nudge]);

  return { nudge, dismiss: markSeen, accept: markSeen };
}
