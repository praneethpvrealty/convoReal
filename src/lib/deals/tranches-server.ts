import type { AccountContext } from '@/lib/auth/account';

import {
  sortTranches,
  summarizeTranches,
  type DealPaymentTranche,
  type TrancheSummary,
} from './tranches';

export interface TrancheSchedule {
  tranches: DealPaymentTranche[];
  summary: TrancheSummary;
}

/** The schedule as both surfaces read it: rows in due order and the
 *  totals, summed here so no client adds money of its own. */
export async function loadTranches(
  ctx: Pick<AccountContext, 'supabase' | 'accountId'>,
  dealId: string
): Promise<TrancheSchedule> {
  const { data, error } = await ctx.supabase
    .from('deal_payment_tranches')
    .select('*')
    .eq('deal_id', dealId)
    .eq('account_id', ctx.accountId);
  if (error) throw new Error(error.message);
  const rows = sortTranches((data ?? []) as DealPaymentTranche[]);
  return { tranches: rows, summary: summarizeTranches(rows) };
}
