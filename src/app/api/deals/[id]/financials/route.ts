import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseEventSource, writeDealEvent } from '@/lib/deals/events';
import {
  DEAL_FINANCIAL_FIELDS,
  derivedToken,
  parseFinancialsPatch,
  tokenSourceFor,
  type DealFinancials,
} from '@/lib/deals/financials';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

const SELECT = ['id', 'deal_room_id', ...DEAL_FINANCIAL_FIELDS].join(', ');

type FinancialsRow = DealFinancials & { id: string; deal_room_id: string | null };

async function loadFinancials(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  dealId: string
) {
  const { data: deal } = await ctx.supabase
    .from('deals')
    .select(SELECT)
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!deal) return null;
  const row = deal as unknown as FinancialsRow;

  let escrow: {
    amount_minor: number;
    status: string;
    provider_ref: string | null;
    funded_at: string | null;
  } | null = null;
  if (row.deal_room_id) {
    const { data } = await ctx.supabase
      .from('token_escrows')
      .select('amount_minor, status, provider_ref, funded_at')
      .eq('deal_room_id', row.deal_room_id)
      .in('status', ['proposed', 'accepted', 'funded', 'released', 'disputed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    escrow = data ?? null;
  }

  const { id: _id, deal_room_id, ...financials } = row;
  void _id;
  return {
    ...financials,
    token_source: tokenSourceFor(row),
    token: derivedToken(row, escrow),
    deal_room_id,
  };
}

// GET /api/deals/[id]/financials — internal figures plus the token
// figure from whichever table is canonical for this deal.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;
    const data = await loadFinancials(ctx, dealId);
    if (!data) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/deals/[id]/financials — record-keeping only. Token fields
// are refused on a Den-linked deal; Token Safe owns them there.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealFinancials:${ctx.userId}`,
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
    const parsed = parseFinancialsPatch(body, tokenSourceFor(deal));
    if (!parsed.ok) {
      const status = /Token Safe/.test(parsed.error) ? 409 : 400;
      return NextResponse.json({ error: parsed.error }, { status });
    }

    const { data: updated, error } = await ctx.supabase
      .from('deals')
      .update(parsed.value)
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

    const fields = Object.keys(parsed.value);
    await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'financials_updated',
      title: `Financials updated (${fields.length} field${fields.length === 1 ? '' : 's'})`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: parseEventSource(body?.source),
      // Field names only. Amounts are internal and never ride an event
      // row, which a later phase may project outward.
      metadata: { fields },
    });

    const data = await loadFinancials(ctx, dealId);
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
