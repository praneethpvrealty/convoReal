import type { SupabaseClient } from '@supabase/supabase-js';

import { writeDealEvent, type DealEventSource } from '@/lib/deals/events';
import { standardMilestoneRows } from '@/lib/deals/milestones';
import { startsClosingRecord } from '@/lib/pipelines/stage-semantics';

export async function ensureClosingRecord({
  db,
  accountId,
  dealId,
  stageName,
  actorId,
  actorName,
  source,
}: {
  db: SupabaseClient;
  accountId: string;
  dealId: string;
  stageName: string | null | undefined;
  actorId: string | null;
  actorName: string | null;
  source: DealEventSource;
}): Promise<number> {
  if (!stageName || !startsClosingRecord(stageName)) return 0;
  const { count } = await db
    .from('deal_milestones')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', dealId)
    .eq('account_id', accountId);
  if ((count ?? 0) > 0) return 0;
  const rows = standardMilestoneRows(accountId, dealId);
  const { error } = await db.from('deal_milestones').insert(rows);
  if (error) return 0;
  await writeDealEvent({
    db,
    accountId,
    dealId,
    eventType: 'milestone_added',
    title: `Added ${rows.length} standard milestones on reaching ${stageName}`,
    actorId,
    actorName,
    source,
    metadata: { template: 'standard', count: rows.length, stage: stageName },
  });
  return rows.length;
}
