'use client';

import { useState, useEffect, useCallback } from 'react';
import type { BillingStatus, Plan } from '@/lib/billing/types';
import { PLAN_CONFIG, planRank } from '@/lib/billing/plan-config';

export function usePlan() {
  const [data, setData] = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/status');
      if (!res.ok) throw new Error('Failed to load billing status');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 60 seconds
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const plan: Plan = data?.limits?.plan ?? 'starter';
  const limits = data?.limits;
  const usage = data?.usage;
  const subscription = data?.subscription;

  function isAllowed(feature: string): boolean {
    if (!limits) return true; // optimistic while loading
    switch (feature) {
      case 'ai': return limits.has_ai;
      case 'teams': return limits.has_teams;
      case 'multi_number': return limits.has_multi_number;
      case 'api_access': return limits.has_api_access;
      case 'branded_showcase': return limits.has_branded_showcase;
      case 'custom_subdomain': return limits.has_custom_subdomain;
      case 'broadcasts': return limits.max_broadcasts_per_month > 0;
      default: return true;
    }
  }

  function limitOf(resource: 'contacts' | 'properties' | 'users' | 'broadcasts'): number {
    if (!limits) return 999999;
    switch (resource) {
      case 'contacts': return limits.max_contacts;
      case 'properties': return limits.max_properties;
      case 'users': return limits.max_users;
      case 'broadcasts': return limits.max_broadcasts_per_month;
    }
  }

  function usageOf(resource: 'contacts' | 'properties' | 'users'): number {
    return usage?.[resource] ?? 0;
  }

  function isAtLimit(resource: 'contacts' | 'properties' | 'users'): boolean {
    const lim = limitOf(resource);
    if (lim >= 999999) return false;
    return usageOf(resource) >= lim;
  }

  function canUpgradeTo(target: Plan): boolean {
    return planRank(target) > planRank(plan);
  }

  return {
    plan,
    planConfig: PLAN_CONFIG[plan],
    limits,
    usage,
    subscription,
    isLoading,
    error,
    isAllowed,
    limitOf,
    usageOf,
    isAtLimit,
    canUpgradeTo,
    refresh,
    upgradeUrl: '/settings?tab=billing',
  };
}
