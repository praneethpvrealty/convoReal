import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  parseStakeholderInput,
  STAKEHOLDER_ROLE_LABELS,
} from '@/lib/deals/stakeholders';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/stakeholders — everyone on the transaction, with
// the live link count per person.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_stakeholders')
      .select(
        '*, links:deal_share_links(id, token_prefix, expires_at, revoked_at, otp_required, view_count, last_viewed_at, created_at)'
      )
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('created_at');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/stakeholders
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealStakeholder:${ctx.userId}`,
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
    const parsed = parseStakeholderInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (parsed.value.contact_id) {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', parsed.value.contact_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
    }

    const { data, error } = await ctx.supabase
      .from('deal_stakeholders')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        created_by: ctx.userId,
        ...parsed.value,
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Best-effort until the held migration widens the CHECK.
    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'stakeholder_added',
      title: `${STAKEHOLDER_ROLE_LABELS[parsed.value.role]} added: ${parsed.value.name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: body?.source === 'mobile' ? 'mobile' : 'web',
      metadata: {
        stakeholder_id: data.id,
        role: parsed.value.role,
        side: parsed.value.side,
      },
    });
    if (!outcome.ok) {
      console.warn('[stakeholders] event not written:', outcome.error);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
