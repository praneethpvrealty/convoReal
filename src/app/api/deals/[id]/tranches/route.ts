import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import { parseTrancheInput, TRANCHE_MAX_PER_DEAL } from '@/lib/deals/tranches';
import { loadTranches } from '@/lib/deals/tranches-server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/tranches — the payment schedule and its totals.
// Internal only: the account's own members, never a stakeholder link.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    return NextResponse.json({ data: await loadTranches(ctx, dealId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/tranches — one tranche: label, amount, and
// optionally when it is due and what has come in.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

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
    const parsed = parseTrancheInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { count } = await ctx.supabase
      .from('deal_payment_tranches')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);
    if ((count ?? 0) >= TRANCHE_MAX_PER_DEAL) {
      return NextResponse.json(
        { error: `A schedule holds at most ${TRANCHE_MAX_PER_DEAL} tranches.` },
        { status: 409 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('deal_payment_tranches')
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
        { error: error?.message ?? 'Could not add the tranche' },
        { status: 400 }
      );
    }

    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: `Payment tranche added: ${parsed.value.label}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: { tranche_id: data.id, fields: ['tranche'] },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
