import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import { parseStakeholderInput } from '@/lib/deals/stakeholders';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = {
  params: Promise<{ id: string; stakeholderId: string }>;
};

// PATCH /api/deals/[id]/stakeholders/[stakeholderId] — the whole
// record is re-validated; a side change re-scopes every live link the
// person holds on the next open, since the resolver reads the side.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, stakeholderId } = await params;

    const limit = await checkRateLimit(
      `agent:dealStakeholder:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: existing } = await ctx.supabase
      .from('deal_stakeholders')
      .select('*')
      .eq('id', stakeholderId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json(
        { error: 'Stakeholder not found' },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const parsed = parseStakeholderInput({ ...existing, ...(body ?? {}) });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_stakeholders')
      .update(parsed.value)
      .eq('id', stakeholderId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'stakeholder_updated',
      title: `Stakeholder updated: ${parsed.value.name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: body?.source === 'mobile' ? 'mobile' : 'web',
      metadata: {
        stakeholder_id: stakeholderId,
        role: parsed.value.role,
        side: parsed.value.side,
        side_changed: existing.side !== parsed.value.side,
      },
    });
    if (!outcome.ok) {
      console.warn('[stakeholders] event not written:', outcome.error);
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id]/stakeholders/[stakeholderId] — cascades their
// links and access log, which is the point: a removed person's link
// dies with them.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, stakeholderId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: removed, error } = await ctx.supabase
      .from('deal_stakeholders')
      .delete()
      .eq('id', stakeholderId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .select('id, name');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'Stakeholder not found' },
        { status: 404 }
      );
    }

    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'stakeholder_removed',
      title: `Stakeholder removed: ${removed[0].name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      metadata: { stakeholder_id: stakeholderId },
    });
    if (!outcome.ok) {
      console.warn('[stakeholders] event not written:', outcome.error);
    }

    return NextResponse.json({ data: { id: stakeholderId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
