'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';

export interface OnboardingStatus {
  hasWhatsApp: boolean;
  hasProperties: boolean;
  hasContacts: boolean;
}

function dismissedKey(accountId: string) {
  return `onboarding_dismissed_${accountId}`;
}

export function useOnboarding() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const accountId = profile?.account_id as string | undefined;
  // Only the account owner needs to complete setup. Agents, admins, and
  // viewers who are added later should never see the onboarding wizard.
  const isOwner = profile?.account_role === 'owner';

  // Check localStorage for dismissed state once account is known
  useEffect(() => {
    if (!accountId) return;
    const key = dismissedKey(accountId);
    setDismissed(localStorage.getItem(key) === 'true');
  }, [accountId]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/status');
      if (!res.ok) return;
      const data: OnboardingStatus = await res.json();
      setStatus(data);
    } catch {
      // Non-critical — fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId && isOwner) refresh();
    else setLoading(false); // non-owners: skip fetch, stay hidden
  }, [accountId, isOwner, refresh]);

  function dismiss() {
    if (!accountId) return;
    localStorage.setItem(dismissedKey(accountId), 'true');
    setDismissed(true);
  }

  const allDone = status
    ? status.hasWhatsApp && status.hasProperties && status.hasContacts
    : false;

  // Show only for account owners who haven't dismissed and haven't completed all steps
  const shouldShow = isOwner && !loading && !dismissed && !!status && !allDone;

  return { status, loading, dismissed, shouldShow, allDone, refresh, dismiss };
}
