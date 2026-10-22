import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  markNudgeSeen,
  nudgeGlobalCooldownActive,
  pickNudge,
} from '@shared/lib/copilot/nudge-pick';

import { apiFetch } from './api';
import { useAuthStore } from './auth-store';
import {
  nudgeLastShownKey,
  nudgeSeenKey,
  type CopilotNudge,
} from './copilot-nudges';
import { normalizeUiLanguage } from './i18n';

// ------------------------------------------------------------------
// Mobile counterpart of the web's useCopilotNudges: one fetch of
// /api/copilot/nudges per app session (8s after the first screen, so
// it never competes with the inbox load), then at most one bubble a
// day and never the same nudge twice in a week. Cooldowns live in
// AsyncStorage per account, the way the web keeps them in
// localStorage, so phone and laptop can each show a nudge once.
// ------------------------------------------------------------------

const FETCH_DELAY_MS = 8_000;

let fetchedThisSession = false;

async function readSeen(key: string): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

export function useCopilotNudges(): {
  nudge: CopilotNudge | null;
  dismiss: () => void;
  accept: () => void;
} {
  const accountId = useAuthStore((s) => s.profile?.account_id ?? null);
  const language = useAuthStore((s) =>
    normalizeUiLanguage(s.profile?.active_ui_language)
  );
  const [nudge, setNudge] = useState<CopilotNudge | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!accountId || fetchedThisSession) return;
    cancelled.current = false;
    const timer = setTimeout(async () => {
      try {
        const lastShown = Number(
          (await AsyncStorage.getItem(nudgeLastShownKey(accountId))) ?? 0
        );
        if (nudgeGlobalCooldownActive(lastShown)) return;
        fetchedThisSession = true;
        const data = await apiFetch<{ nudges: CopilotNudge[] }>(
          `/api/copilot/nudges?lang=${encodeURIComponent(language)}`
        );
        const seen = await readSeen(nudgeSeenKey(accountId));
        const pick = pickNudge(data.nudges, seen);
        if (pick && !cancelled.current) setNudge(pick);
      } catch {
        // Best-effort: a failed nudge fetch is never surfaced.
      }
    }, FETCH_DELAY_MS);
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [accountId, language]);

  const markSeen = useCallback(() => {
    if (!accountId || !nudge) return;
    const id = nudge.id;
    setNudge(null);
    void (async () => {
      try {
        await AsyncStorage.setItem(
          nudgeLastShownKey(accountId),
          String(Date.now())
        );
        const seen = await readSeen(nudgeSeenKey(accountId));
        await AsyncStorage.setItem(
          nudgeSeenKey(accountId),
          JSON.stringify(markNudgeSeen(seen, id))
        );
      } catch {}
    })();
  }, [accountId, nudge]);

  return { nudge, dismiss: markSeen, accept: markSeen };
}
