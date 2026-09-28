import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { parsePayoutPatch } from '@/lib/deals/co-broking';
import { stakeholderOnDeal } from '@/lib/deals/co-broking-server';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string; payoutId: string }> };

// PATCH /api/deals/[id]/co-broking/payouts/[payoutId] — the broker, the
// amount, and when and how it was paid. Amounts never ride the event.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, payoutId } = await params;

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
    const parsed = parsePayoutPatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (
      parsed.value.stakeholder_id &&
      !(await stakeholderOnDeal(ctx, dealId, parsed.value.stakeholder_id))
    ) {
      return NextResponse.json(
        { error: 'That stakeholder is not on this deal' },
        { status: 400 }
      );
    }

    const { data: before } = await ctx.supabase
      .from('deal_co_broker_payouts')
      .select('id, paid_at')
      .eq('id', payoutId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!before) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_co_broker_payouts')
      .update(parsed.value)
      .eq('id', payoutId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Could not update the payout' },
        { status: 400 }
      );
    }

    const nowPaid = !before.paid_at && Boolean(data.paid_at);
    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: nowPaid
        ? `Co-broker paid: ${data.payee_name}`
        : `Co-broker payout updated: ${data.payee_name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { payout_id: payoutId, fields: Object.keys(parsed.value) },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id]/co-broking/payouts/[payoutId] — a payout
// recorded in error. One already paid stays: correct it instead.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, payoutId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: row } = await ctx.supabase
      .from('deal_co_broker_payouts')
      .select('id, payee_name, paid_at, paid_amount')
      .eq('id', payoutId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }
    if (row.paid_at || Number(row.paid_amount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'A payout that has been paid cannot be removed. Correct it instead.',
          code: 'PAYOUT_PAID',
        },
        { status: 409 }
      );
    }

    const { data: removed, error } = await ctx.supabase
      .from('deal_co_broker_payouts')
      .delete()
      .eq('id', payoutId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to remove this payout.' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: `Co-broker payout removed: ${row.payee_name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { payout_id: payoutId, fields: ['co_broker_payout'] },
    });

    return NextResponse.json({ data: { id: payoutId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
