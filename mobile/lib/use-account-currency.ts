import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from './auth-store';
import { supabase } from './supabase';

interface AccountRegion {
  currency: string;
  countryCode: string;
}

function useAccountRegion(): AccountRegion | undefined {
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const { data } = useQuery({
    queryKey: ['account-region', accountId],
    enabled: Boolean(accountId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('showcase_settings')
        .select('currency, default_country_code')
        .eq('account_id', accountId!)
        .maybeSingle();
      if (error) throw error;
      return {
        currency: row?.currency || 'INR',
        countryCode: row?.default_country_code || '91',
      };
    },
  });
  return data;
}

export function useAccountCurrency(): string {
  return useAccountRegion()?.currency ?? 'INR';
}

export function useAccountCountryCode(): string {
  return useAccountRegion()?.countryCode ?? '91';
}
