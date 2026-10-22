import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  emailLeadsSkippedKey,
  onboardingDismissedKey,
  setupAllDone,
  setupSteps,
  type OnboardingStatus,
  type SetupStep,
} from '@shared/lib/onboarding/checklist';

import { apiFetch } from './api';
import { useAuthStore } from './auth-store';

// ------------------------------------------------------------------
// Mobile counterpart of the web's useOnboarding (src/hooks/useOnboarding.ts):
// the same /api/onboarding/status read, the same owner-only gate, and
// the same per-account dismissal — kept in AsyncStorage here the way
// the web keeps it in localStorage. The app has no modal wizard; the
// checklist card on the inbox is the whole surface, so "dismiss" hides
// it for this device and the web wizard still picks the owner up.
// ------------------------------------------------------------------

export function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return apiFetch<OnboardingStatus>('/api/onboarding/status');
}

export function useSetupChecklist(): {
  steps: SetupStep[] | null;
  show: boolean;
  dismiss: () => void;
} {
  const accountId = useAuthStore((s) => s.profile?.account_id ?? null);
  const isOwner = useAuthStore((s) => s.profile?.account_role === 'owner');
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [emailLeadsSkipped, setEmailLeadsSkipped] = useState(false);

  useEffect(() => {
    if (!accountId || !isOwner) return;
    let active = true;
    AsyncStorage.multiGet([
      onboardingDismissedKey(accountId),
      emailLeadsSkippedKey(accountId),
    ])
      .then(([[, dismissedRaw], [, skippedRaw]]) => {
        if (!active) return;
        setDismissed(dismissedRaw === 'true');
        setEmailLeadsSkipped(skippedRaw === 'true');
      })
      .catch(() => {
        if (active) setDismissed(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, isOwner]);

  const status = useQuery({
    queryKey: ['onboarding-status', accountId],
    queryFn: fetchOnboardingStatus,
    enabled: !!accountId && isOwner && dismissed === false,
    staleTime: 60_000,
  });

  const dismiss = useCallback(() => {
    if (!accountId) return;
    setDismissed(true);
    AsyncStorage.setItem(onboardingDismissedKey(accountId), 'true').catch(
      () => {}
    );
  }, [accountId]);

  const steps = status.data ? setupSteps(status.data, emailLeadsSkipped) : null;
  const show =
    isOwner &&
    dismissed === false &&
    !!status.data &&
    !setupAllDone(status.data, emailLeadsSkipped);

  return { steps, show, dismiss };
}
