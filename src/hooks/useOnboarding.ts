'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';

export interface OnboardingStatus {
  hasWhatsApp: boolean;
  hasProperties: boolean;
  hasContacts: boolean;
  hasEmailLeadSync: boolean;
}

function dismissedKey(accountId: string) {
  return `onboarding_dismissed_${accountId}`;
}

// Email lead sync is the one step a consultant may legitimately never
// complete (not everyone lists on portals), so "skip" is persisted
// per-account instead of nagging on every visit.
function emailLeadsSkippedKey(accountId: string) {
  return `onboarding_email_leads_skipped_${accountId}`;
}

export function useOnboarding() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [emailLeadsSkipped, setEmailLeadsSkipped] = useState(false);

  const accountId = profile?.account_id as string | undefined;
  // Only the account owner needs to complete setup. Agents, admins, and
  // viewers who are added later should never see the onboarding wizard.
  const isOwner = profile?.account_role === 'owner';

  // Check localStorage for dismissed state once account is known
  useEffect(() => {
    if (!accountId) return;
    const key = dismissedKey(accountId);
    setDismissed(localStorage.getItem(key) === 'true');
    setEmailLeadsSkipped(
      localStorage.getItem(emailLeadsSkippedKey(accountId)) === 'true'
    );
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

  function skipEmailLeads() {
    if (!accountId) return;
    localStorage.setItem(emailLeadsSkippedKey(accountId), 'true');
    setEmailLeadsSkipped(true);
  }

  // Un-dismiss: the dashboard setup checklist reopens the wizard here.
  function reopen() {
    if (!accountId) return;
    localStorage.removeItem(dismissedKey(accountId));
    setDismissed(false);
  }

  const allDone = status
    ? status.hasWhatsApp &&
      status.hasProperties &&
      status.hasContacts &&
      (status.hasEmailLeadSync || emailLeadsSkipped)
    : false;

  // Show only for account owners who haven't dismissed and haven't completed all steps
  const shouldShow = isOwner && !loading && !dismissed && !!status && !allDone;

  return {
    status,
    loading,
    dismissed,
    shouldShow,
    allDone,
    emailLeadsSkipped,
    refresh,
    dismiss,
    reopen,
    skipEmailLeads,
  };
}
