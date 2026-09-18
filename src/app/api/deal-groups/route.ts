import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/deal-groups — bundle deals that close together (one buyer,
// two plots). Each stays its own deal; the group is a label with
// combined progress, never a parent.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:dealGroup:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) {
      return NextResponse.json(
        { error: 'Name must be 1–120 characters' },
        { status: 400 }
      );
    }
    const dealIds = Array.isArray(body?.deal_ids)
      ? Array.from(
          new Set(
            body.deal_ids.filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0
            )
          )
        )
      : [];
    if (dealIds.length < 2 || dealIds.length > 20) {
      return NextResponse.json(
        { error: 'A bundle needs between 2 and 20 deals' },
        { status: 400 }
      );
    }

    const { data: deals } = await ctx.supabase
      .from('deals')
      .select('id, deal_group_id')
      .eq('account_id', ctx.accountId)
      .in('id', dealIds);
    if ((deals ?? []).length !== dealIds.length) {
      return NextResponse.json(
        { error: 'One or more deals were not found' },
        { status: 404 }
      );
    }
    if ((deals ?? []).some((d) => d.deal_group_id)) {
      return NextResponse.json(
        { error: 'A deal is already in another bundle' },
        { status: 409 }
      );
    }

    const { data: group, error } = await ctx.supabase
      .from('deal_groups')
      .insert({ account_id: ctx.accountId, name, created_by: ctx.userId })
      .select('*')
      .single();
    if (error || !group) {
      return NextResponse.json(
        { error: error?.message ?? 'Could not create the bundle' },
        { status: 400 }
      );
    }

    const { data: linked, error: linkError } = await ctx.supabase
      .from('deals')
      .update({ deal_group_id: group.id })
      .eq('account_id', ctx.accountId)
      .in('id', dealIds)
      .select('id');
    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }
    if ((linked ?? []).length !== dealIds.length) {
      return NextResponse.json(
        { error: 'You do not have permission to bundle these deals.' },
        { status: 403 }
      );
    }

    const name_ = await actorName(ctx.supabase, ctx.accountId, ctx.userId);
    await Promise.all(
      dealIds.map((dealId) =>
        writeDealEvent({
          db: ctx.supabase,
          accountId: ctx.accountId,
          dealId,
          eventType: 'group_changed',
          title: `Added to bundle: ${name}`,
          actorId: ctx.userId,
          actorName: name_,
          metadata: { group_id: group.id, group_name: name, members: dealIds },
        })
      )
    );

    return NextResponse.json({ data: group }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
