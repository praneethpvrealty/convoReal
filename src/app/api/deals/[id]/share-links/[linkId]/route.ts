import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';

type RouteParams = { params: Promise<{ id: string; linkId: string }> };

// DELETE /api/deals/[id]/share-links/[linkId] — revoke. The row stays
// so the access log keeps its history; the link stops resolving on
// the next request.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId, linkId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: revoked, error } = await ctx.supabase
      .from('deal_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id, stakeholder:deal_stakeholders(name)');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!revoked?.length) {
      return NextResponse.json(
        { error: 'Link not found or already revoked' },
        { status: 404 }
      );
    }

    const holder = revoked[0].stakeholder as
      | { name: string }
      | { name: string }[]
      | null;
    const name = Array.isArray(holder) ? holder[0]?.name : holder?.name;

    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'link_revoked',
      title: `Share link revoked${name ? ` for ${name}` : ''}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: new URL(request.url).searchParams.get('source') === 'mobile' ? 'mobile' : 'web',
      metadata: { link_id: linkId },
    });
    if (!outcome.ok) {
      console.warn('[share-links] event not written:', outcome.error);
    }

    return NextResponse.json({ data: { id: linkId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
