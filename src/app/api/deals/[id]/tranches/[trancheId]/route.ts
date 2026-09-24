import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import { parseTranchePatch } from '@/lib/deals/tranches';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string; trancheId: string }> };

// PATCH /api/deals/[id]/tranches/[trancheId] — label, amount, dates,
// what came in and by which instrument. Amounts never ride the event.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, trancheId } = await params;

    const limit = await checkRateLimit(
      `agent:dealTranche:${ctx.userId}`,
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
    const parsed = parseTranchePatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: before } = await ctx.supabase
      .from('deal_payment_tranches')
      .select('id, label, received_at')
      .eq('id', trancheId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!before) {
      return NextResponse.json({ error: 'Tranche not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_payment_tranches')
      .update(parsed.value)
      .eq('id', trancheId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Could not update the tranche' },
        { status: 400 }
      );
    }

    const nowReceived = !before.received_at && Boolean(data.received_at);
    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: nowReceived
        ? `Payment received: ${data.label}`
        : `Payment tranche updated: ${data.label}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { tranche_id: trancheId, fields: Object.keys(parsed.value) },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id]/tranches/[trancheId] — a tranche recorded in
// error. One that has money against it stays: correct it instead.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, trancheId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: row } = await ctx.supabase
      .from('deal_payment_tranches')
      .select('id, label, received_at, received_amount')
      .eq('id', trancheId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: 'Tranche not found' }, { status: 404 });
    }
    if (row.received_at || (row.received_amount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'A tranche with money received cannot be removed. Correct it instead.',
          code: 'TRANCHE_RECEIVED',
        },
        { status: 409 }
      );
    }

    const { data: removed, error } = await ctx.supabase
      .from('deal_payment_tranches')
      .delete()
      .eq('id', trancheId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to remove this tranche.' },
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
      title: `Payment tranche removed: ${row.label}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { tranche_id: trancheId, fields: ['tranche'] },
    });

    return NextResponse.json({ data: { id: trancheId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
