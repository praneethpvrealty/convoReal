import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import { standardMilestoneRows } from '@/lib/deals/milestones';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/milestones — the checklist, in order.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_milestones')
      .select('*')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('position')
      .order('created_at');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/milestones
//   { template: 'standard' }              — add the standard checklist
//   { title, target_date?, owner_id? }    — add one custom milestone
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

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
    const source = parseEventSource(body?.source);
    const name = await actorName(ctx.supabase, ctx.accountId, ctx.userId);

    const { data: existing } = await ctx.supabase
      .from('deal_milestones')
      .select('template_key, position')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);

    if (body?.template === 'standard') {
      const rows = standardMilestoneRows(
        ctx.accountId,
        dealId,
        (existing ?? []).map((m) => m.template_key as string | null)
      );
      if (rows.length === 0) {
        return NextResponse.json({ data: [] });
      }
      const offset = (existing ?? []).reduce(
        (max, m) => Math.max(max, Number(m.position) + 1),
        0
      );
      const { data, error } = await ctx.supabase
        .from('deal_milestones')
        .insert(rows.map((r) => ({ ...r, position: r.position + offset })))
        .select('*');
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      await writeDealEvent({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        eventType: 'milestone_added',
        title: `Added ${rows.length} standard milestones`,
        actorId: ctx.userId,
        actorName: name,
        source,
        metadata: { template: 'standard', count: rows.length },
      });
      return NextResponse.json({ data: data ?? [] }, { status: 201 });
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120) {
      return NextResponse.json(
        { error: 'Title must be 1–120 characters' },
        { status: 400 }
      );
    }
    const targetDate =
      typeof body?.target_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)
        ? body.target_date
        : null;
    const ownerId =
      typeof body?.owner_id === 'string' && body.owner_id.trim()
        ? body.owner_id.trim()
        : null;
    const position = (existing ?? []).reduce(
      (max, m) => Math.max(max, Number(m.position) + 1),
      0
    );

    const { data, error } = await ctx.supabase
      .from('deal_milestones')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        template_key: null,
        title,
        position,
        target_date: targetDate,
        owner_id: ownerId,
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'milestone_added',
      title: `Milestone added: ${title}`,
      actorId: ctx.userId,
      actorName: name,
      source,
      metadata: { milestone_id: data.id, title, target_date: targetDate },
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
