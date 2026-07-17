import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuthStore } from './auth-store';
import { queryClient } from './query';
import { supabase } from './supabase';

export interface CreditsState {
  total: number;
  isLoading: boolean;
}

/**
 * Mobile mirror of the web's useCredits (src/hooks/useCredits.ts):
 * credit_wallets.total_credits for the account, kept live via a
 * Realtime UPDATE subscription. The plan's gated-burn rule: at 0,
 * AI-assisted actions lock and purchasing happens on the web.
 */
export function useCredits(): CreditsState {
  const accountId = useAuthStore((s) => s.profile?.account_id);

  const { data, isLoading } = useQuery({
    queryKey: ['credits', accountId],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('credit_wallets')
        .select('total_credits')
        .eq('account_id', accountId!)
        .maybeSingle();
      if (error) throw error;
      return row?.total_credits ?? 0;
    },
  });

  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`credits:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'credit_wallets',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['credits', accountId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return { total: data ?? 0, isLoading };
}
