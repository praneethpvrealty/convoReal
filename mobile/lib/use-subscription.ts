import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/lib/auth-store';
import type { Plan } from '@/lib/plan-meta';
import { supabase } from '@/lib/supabase';

export interface SubscriptionState {
  plan?: Plan;
  status?: string;
  isLoading: boolean;
  /** Only owners can read the subscriptions row (RLS) — the card hides
   *  for everyone else. */
  canView: boolean;
}

/**
 * Current subscription plan for the account. Reads the `subscriptions`
 * row directly (like use-credits reads credit_wallets); RLS scopes it to
 * owners, and an account with no row is on `starter` (same fallback the
 * web's plan gates use).
 */
export function useSubscription(): SubscriptionState {
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const isOwner = useAuthStore((s) => s.profile?.account_role) === 'owner';

  const { data, isLoading } = useQuery({
    queryKey: ['subscription', accountId],
    enabled: Boolean(accountId) && isOwner,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: row } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('account_id', accountId!)
        .maybeSingle();
      return {
        plan: (row?.plan ?? 'starter') as Plan,
        status: (row?.status ?? 'active') as string,
      };
    },
  });

  return { plan: data?.plan, status: data?.status, isLoading, canView: isOwner };
}
