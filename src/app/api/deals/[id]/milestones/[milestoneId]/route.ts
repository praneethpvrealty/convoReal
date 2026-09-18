import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import {
  DEAL_MILESTONE_STATUS_LABELS,
  milestoneUpdateData,
  parseMilestonePatch,
  type DealMilestoneStatus,
} from '@/lib/deals/milestones';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string; milestoneId: string }> };

// PATCH /api/deals/[id]/milestones/[milestoneId] — status, dates, owner,
// title, notes. Never the deal's stage: that is the board's job.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId, milestoneId } = await params;

    const limit = await checkRateLimit(
      `agent:dealMilestone:${ctx.userId}`,
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
    const parsed = parseMilestonePatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: before } = await ctx.supabase
      .from('deal_milestones')
      .select('id, title, status')
      .eq('id', milestoneId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!before) {
      return NextResponse.json(
        { error: 'Milestone not found' },
        { status: 404 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('deal_milestones')
      .update(milestoneUpdateData(parsed.value))
      .eq('id', milestoneId)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const fromStatus = before.status as DealMilestoneStatus;
    const toStatus = parsed.value.status ?? fromStatus;
    const title =
      parsed.value.status && parsed.value.status !== fromStatus
        ? `${data.title}: ${DEAL_MILESTONE_STATUS_LABELS[toStatus]}`
        : `Milestone updated: ${data.title}`;

    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'milestone_updated',
      title,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      metadata: {
        milestone_id: milestoneId,
        fields: Object.keys(parsed.value),
        from_status: fromStatus,
        to_status: toStatus,
        target_date: data.target_date,
      },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id]/milestones/[milestoneId] — only a custom
// milestone; a standard one is skipped, not removed, so the checklist
// stays comparable across deals.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId, milestoneId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: row } = await ctx.supabase
      .from('deal_milestones')
      .select('id, template_key')
      .eq('id', milestoneId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json(
        { error: 'Milestone not found' },
        { status: 404 }
      );
    }
    if (row.template_key) {
      return NextResponse.json(
        { error: 'Standard milestones are skipped, not deleted.' },
        { status: 409 }
      );
    }

    const { data: removed, error } = await ctx.supabase
      .from('deal_milestones')
      .delete()
      .eq('id', milestoneId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!removed?.length) {
      return NextResponse.json(
        { error: 'You do not have permission to remove this milestone.' },
        { status: 403 }
      );
    }
    return NextResponse.json({ data: { id: milestoneId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
