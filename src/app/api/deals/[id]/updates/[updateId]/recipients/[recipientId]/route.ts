import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { loadDealHead } from '@/lib/deals/server';

type RouteParams = {
  params: Promise<{ id: string; updateId: string; recipientId: string }>;
};

// PATCH /api/deals/[id]/updates/[updateId]/recipients/[recipientId]
//   { status: 'sent' } — the agent confirms a handoff or link-only
//   delivery went out from their own phone. The only transition a
//   client may write; opened and acknowledged come from the portal.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, updateId, recipientId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    if (body?.status !== 'sent') {
      return NextResponse.json(
        { error: 'Only status: "sent" can be recorded here' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('deal_update_recipients')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', recipientId)
      .eq('update_id', updateId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .eq('status', 'pending')
      .in('delivery_mode', ['handoff', 'portal'])
      .select('*');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Nothing to mark: the delivery is not a pending handoff' },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
