'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { localCache } from '@/lib/cache-store';
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

const CACHE_KEY = 'credits-wallet';
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
 * refresh. Debounced via localCache so the header chip and sidebar
 * widget (both mounting this hook) share one network request.
 */
export function useCredits(): CreditState & { refresh: () => Promise<void> } {
  const { accountId } = useAuth();
  const [state, setState] = useState<CreditState>(DEFAULT_STATE);

  const refresh = useCallback(async () => {
    const cached = localCache.get<CreditState>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) {
      setState(cached);
      return;
    }
    try {
      const res = await fetch('/api/billing/credits');
      if (!res.ok) return;
      const json = await res.json();
      const next: CreditState = {
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
      localCache.set(CACHE_KEY, next);
      setState(next);
    } catch (err) {
      console.error('[useCredits] refresh failed:', err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [refresh]);

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
          const row = payload.new as CreditWalletRow;
          const next = fromWalletRow(row);
          localCache.set(CACHE_KEY, next);
          setState(next);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return { ...state, refresh };
}
