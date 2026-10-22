'use client';

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

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocale } from '@/hooks/useLocale';
import type { CopilotNudge } from '@/lib/copilot/nudges';
import {
  markNudgeSeen,
  nudgeGlobalCooldownActive,
  pickNudge,
} from '@/lib/copilot/nudge-pick';
import { readStored, readStoredJson, writeStored } from '@/lib/safe-storage';

const FETCH_DELAY_MS = 8_000;
const SESSION_FETCH_KEY = 'copilot_nudges_fetched';

function readSeen(key: string): Record<string, number> {
  return readStoredJson<Record<string, number>>(key, {});
}

export function useCopilotNudges(): {
  nudge: CopilotNudge | null;
  /** User closed the bubble — start both cooldowns. */
  dismiss: () => void;
  /** User tapped the CTA — same cooldowns, caller runs the action. */
  accept: () => void;
} {
  const { profile } = useAuth();
  const { language } = useLocale();
  const accountId = profile?.account_id as string | undefined;
  const [nudge, setNudge] = useState<CopilotNudge | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const lastShownKey = `copilot_nudge_last_shown_${accountId}`;
    const seenKey = `copilot_nudge_seen_${accountId}`;

    const lastShown = Number(readStored(lastShownKey) ?? 0);
    if (nudgeGlobalCooldownActive(lastShown)) return;
    if (readStored(SESSION_FETCH_KEY, 'session')) return;

    const timer = setTimeout(async () => {
      writeStored(SESSION_FETCH_KEY, '1', 'session');
      try {
        const res = await fetch(
          `/api/copilot/nudges?lang=${encodeURIComponent(language)}`
        );
        if (!res.ok) return;
        const data: { nudges: CopilotNudge[] } = await res.json();
        const pick = pickNudge(data.nudges, readSeen(seenKey));
        if (pick) setNudge(pick);
      } catch {
        // Nudges are best-effort — never surface an error for them.
      }
    }, FETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [accountId, language]);

  const markSeen = useCallback(() => {
    if (!accountId || !nudge) return;
    writeStored(`copilot_nudge_last_shown_${accountId}`, String(Date.now()));
    const seenKey = `copilot_nudge_seen_${accountId}`;
    writeStored(
      seenKey,
      JSON.stringify(markNudgeSeen(readSeen(seenKey), nudge.id))
    );
    setNudge(null);
  }, [accountId, nudge]);

  return { nudge, dismiss: markSeen, accept: markSeen };
}
