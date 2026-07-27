'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { deriveCreditStatus, type CreditStatus } from '@/lib/credits/types';
import { useAuth } from './use-auth';

export interface CreditState {
  total: number;
  monthly: number;
  bonus: number;
  referral: number;
  purchased: number;
  promo: number;
  pendingReferral: number;
  monthlyResetAt: string | null;
  status: CreditStatus;
  isLoading: boolean;
}

const DEFAULT_STATE: CreditState = {
  total: 0,
  monthly: 0,
  bonus: 0,
  referral: 0,
  purchased: 0,
  promo: 0,
  pendingReferral: 0,
  monthlyResetAt: null,
  status: 'healthy',
  isLoading: true,
};

const CACHE_TTL_MS = 5000;

interface CreditWalletRow {
  account_id: string;
  total_credits: number;
  monthly_credits: number;
  bonus_credits: number;
  referral_credits: number;
  purchased_credits: number;
  promo_credits: number;
  pending_referral_credits: number;
  monthly_reset_at: string | null;
}

function fromWalletRow(row: CreditWalletRow): CreditState {
  return {
    total: row.total_credits,
    monthly: row.monthly_credits,
    bonus: row.bonus_credits,
    referral: row.referral_credits,
    purchased: row.purchased_credits,
    promo: row.promo_credits,
    pendingReferral: row.pending_referral_credits,
    monthlyResetAt: row.monthly_reset_at,
    status: deriveCreditStatus(row.total_credits),
    isLoading: false,
  };
}

/**
 * Live credit balance for the current account — 60s poll plus a
 * Supabase Realtime subscription on credit_wallets so the meter
 * updates immediately after any AI call or top-up, without a page
 * refresh.
 *
 * This hook is mounted more than once at a time (header CreditMeter +
 * sidebar SidebarCreditWidget). It used to hold a 5-second localCache
 * TTL so those mounts wouldn't each hit the network — but the poll
 * timers were still per-mount, so the account was billed two requests a
 * minute for one number. A shared query key gives real deduplication:
 * one request, one 60s interval, every mount reading the same cache.
 */
export function useCredits(): CreditState & { refresh: () => Promise<void> } {
  const { accountId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['credits', accountId], [accountId]);

  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<CreditState> => {
      const res = await fetch('/api/billing/credits');
      if (!res.ok) throw new Error(`credits request failed (${res.status})`);
      const json = await res.json();
      return {
        total: json.total,
        monthly: json.monthly,
        bonus: json.bonus,
        referral: json.referral,
        purchased: json.purchased,
        promo: json.promo,
        pendingReferral: json.pendingReferral,
        monthlyResetAt: json.monthlyResetAt,
        status: json.status,
        isLoading: false,
      };
    },
    refetchInterval: 60_000,
    staleTime: CACHE_TTL_MS,
  });

  const state = data ?? DEFAULT_STATE;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();

    // Unique topic per mount — this hook is mounted twice at once
    // (header CreditMeter + sidebar SidebarCreditWidget). Supabase's
    // client reuses an existing channel object for a repeated topic
    // name, and calling .on() on one that's already subscribe()'d
    // throws ("cannot add postgres_changes callbacks ... after
    // subscribe()"). A random suffix keeps each mount's channel
    // distinct while still listening to the same table/filter.
    const topic = `credit-wallet-realtime-${accountId}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'credit_wallets', filter: `account_id=eq.${accountId}` },
        (payload) => {
          // Written straight into the cache, so every mount of this
          // hook re-renders from one event without a refetch.
          queryClient.setQueryData(queryKey, fromWalletRow(payload.new as CreditWalletRow));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, queryClient, queryKey]);

  return { ...state, refresh };
}
