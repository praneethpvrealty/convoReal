import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  DEAL_POSITION_LABELS,
  parseDealPosition,
} from '@/lib/deals/co-broking';
import { loadCoBroking } from '@/lib/deals/co-broking-server';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/co-broking — where the brokerage stands on the
// deal, what it pays the other brokers, and its own share.
// Internal only: the account's own members, never a stakeholder link.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const view = await loadCoBroking(ctx, dealId);
    if (!view) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    return NextResponse.json({ data: view });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/deals/[id]/co-broking — { deal_position }.
export async function PATCH(request: Request, { params }: RouteParams) {
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
    if (!body || body.deal_position === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    const parsed = parseDealPosition(body.deal_position);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: updated, error } = await ctx.supabase
      .from('deals')
      .update({ deal_position: parsed.value })
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!updated?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to edit this deal.' },
        { status: 403 }
      );
    }

    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: parsed.value
        ? `Position: ${DEAL_POSITION_LABELS[parsed.value].split(' — ')[0]}`
        : 'Position cleared',
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body.source),
      metadata: { fields: ['deal_position'] },
    });

    return NextResponse.json({ data: await loadCoBroking(ctx, dealId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
