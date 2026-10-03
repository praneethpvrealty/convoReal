import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { loadMatchEvents } from '@/lib/radar/queries';
import { fetchGaps } from '@/app/(dashboard)/gaps/gaps-content';

export function useDashboardTabCounts(accountId: string | null | undefined) {
  const enabled = Boolean(accountId);

  const radar = useQuery({
    queryKey: ['match-radar', accountId],
    queryFn: () => loadMatchEvents(createClient()),
    enabled,
    staleTime: 60_000,
  });

  const gaps = useQuery({
    queryKey: ['conversation-gaps', accountId],
    queryFn: fetchGaps,
    enabled,
  });

  return { radar: radar.data?.length ?? 0, gaps: gaps.data?.length ?? 0 };
}
