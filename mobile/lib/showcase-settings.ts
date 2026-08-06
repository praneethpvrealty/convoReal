import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';

/**
 * The account's showcase subdomain, cached per account. Every share
 * link the app builds has to carry it — a listing sent from a phone
 * must land on the agency's own showcase, not the bare marketing
 * domain — and several surfaces need it, so they share one query.
 */
export async function fetchShowcaseSubdomain(
  accountId: string | null
): Promise<string | null> {
  if (!accountId) return null;
  const settings = await queryClient.fetchQuery({
    queryKey: ['showcase-settings', accountId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('showcase_settings')
        .select('subdomain')
        .eq('account_id', accountId)
        .maybeSingle();
      return (data ?? null) as { subdomain: string | null } | null;
    },
  });
  return settings?.subdomain ?? null;
}
