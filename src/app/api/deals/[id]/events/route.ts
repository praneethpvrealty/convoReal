import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { parseNoteInput, writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/events — the immutable timeline, newest first.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get('limit')) || 200)
    );

    const { data, error } = await ctx.supabase
      .from('deal_events')
      .select('*')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/events — an internal note on the timeline. The
// only event type a client may write directly; everything else is
// recorded by the route that did the work.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealNote:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const parsed = parseNoteInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'note_added',
      title:
        parsed.value.note.length > 120
          ? `${parsed.value.note.slice(0, 117)}…`
          : parsed.value.note,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parsed.value.source,
      metadata: { note: parsed.value.note },
    });
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error ?? 'Could not add the note' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { data: { id: outcome.eventId } },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
