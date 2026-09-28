import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import {
  CO_BROKER_PAYOUT_MAX_PER_DEAL,
  parsePayoutInput,
} from '@/lib/deals/co-broking';
import { brokerOnDeal } from '@/lib/deals/co-broking-server';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/deals/[id]/co-broking/payouts — one broker the brokerage
// pays out of the commission it collects.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealCoBroking:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const parsed = parsePayoutInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (
      parsed.value.stakeholder_id &&
      !(await brokerOnDeal(ctx, dealId, parsed.value.stakeholder_id))
    ) {
      return NextResponse.json(
        { error: 'That stakeholder is not a broker on this deal' },
        { status: 400 }
      );
    }

    const { count } = await supabaseAdmin()
      .from('deal_co_broker_payouts')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);
    if ((count ?? 0) >= CO_BROKER_PAYOUT_MAX_PER_DEAL) {
      return NextResponse.json(
        {
          error: `A deal holds at most ${CO_BROKER_PAYOUT_MAX_PER_DEAL} co-broker payouts.`,
        },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin()
      .from('deal_co_broker_payouts')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        position: count ?? 0,
        created_by: ctx.userId,
        ...parsed.value,
      })
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Could not add the payout' },
        { status: 400 }
      );
    }

    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: `Co-broker payout added: ${parsed.value.payee_name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { payout_id: data.id, fields: ['co_broker_payout'] },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
