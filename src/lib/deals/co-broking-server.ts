import type { AccountContext } from '@/lib/auth/account';
import { brokerageAmount } from '@/lib/pipelines/brokerage';

import {
  sortPayouts,
  summarizeCoBroking,
  type CoBrokingBroker,
  type CoBrokingView,
  type DealCoBrokerPayout,
  type DealPosition,
} from './co-broking';

export type { CoBrokingView };

/** The co-broking record as both surfaces read it: the deal's position,
 *  the payouts in order, the totals summed here, and the brokers on the
 *  deal to pick a payee from. */
export async function loadCoBroking(
  ctx: Pick<AccountContext, 'supabase' | 'accountId'>,
  dealId: string
): Promise<CoBrokingView | null> {
  const [dealRes, payoutRes, brokerRes] = await Promise.all([
    ctx.supabase
      .from('deals')
      .select(
        'id, value, brokerage_type, brokerage_value, brokerage_amount, deal_position'
      )
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle(),
    ctx.supabase
      .from('deal_co_broker_payouts')
      .select('*')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId),
    ctx.supabase
      .from('deal_stakeholders')
      .select('id, name, side')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .eq('role', 'broker')
      .order('created_at'),
  ]);
  if (dealRes.error) throw new Error(dealRes.error.message);
  if (payoutRes.error) throw new Error(payoutRes.error.message);
  if (brokerRes.error) throw new Error(brokerRes.error.message);
  const deal = dealRes.data as {
    value: number | null;
    brokerage_type: 'percentage' | 'fixed' | null;
    brokerage_value: number | null;
    brokerage_amount: number | null;
    deal_position: DealPosition | null;
  } | null;
  if (!deal) return null;

  const collected =
    deal.brokerage_amount != null
      ? Number(deal.brokerage_amount)
      : deal.brokerage_value
        ? brokerageAmount({
            dealValue: deal.value,
            type: deal.brokerage_type,
            value: deal.brokerage_value,
          })
        : null;

  const payouts = sortPayouts(
    ((payoutRes.data ?? []) as DealCoBrokerPayout[]).map((p) => ({
      ...p,
      amount: Number(p.amount),
      paid_amount: p.paid_amount === null ? null : Number(p.paid_amount),
      share_percent: p.share_percent === null ? null : Number(p.share_percent),
    }))
  );

  return {
    position: deal.deal_position,
    deal_value: deal.value === null ? null : Number(deal.value),
    payouts,
    summary: summarizeCoBroking(collected, payouts),
    brokers: (brokerRes.data ?? []) as CoBrokingBroker[],
  };
}

export async function brokerOnDeal(
  ctx: Pick<AccountContext, 'supabase' | 'accountId'>,
  dealId: string,
  stakeholderId: string
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('deal_stakeholders')
    .select('id')
    .eq('id', stakeholderId)
    .eq('deal_id', dealId)
    .eq('account_id', ctx.accountId)
    .eq('role', 'broker')
    .maybeSingle();
  return Boolean(data);
}
