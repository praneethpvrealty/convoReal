import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadDealHead } from '@/lib/deals/server';

type RouteParams = { params: Promise<{ id: string; linkId: string }> };

// GET /api/deals/[id]/share-links/[linkId]/access — who opened what,
// newest first. Addresses are hashed at write time; nothing here can
// identify a device beyond its user agent.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId, linkId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const limit = Math.min(
      200,
      Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 50)
    );

    const { data, error } = await ctx.supabase
      .from('deal_share_access_log')
      .select('id, event, document_id, user_agent, created_at')
      .eq('link_id', linkId)
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
