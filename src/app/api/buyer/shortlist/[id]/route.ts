// DELETE /api/buyer/shortlist/[id] — remove a saved property.

import { NextResponse } from 'next/server';

import { withBuyerAuth, buyerAdmin } from '@/lib/buyer/auth';

export const DELETE = withBuyerAuth(async (ctx, _req, routeCtx) => {
  const { id } = await routeCtx.params;

  const { error } = await buyerAdmin()
    .from('buyer_shortlist_items')
    .delete()
    .eq('id', id)
    .eq('buyer_user_id', ctx.buyerUserId);

  if (error) {
    console.error('[buyer/shortlist DELETE] delete failed:', error);
    return NextResponse.json(
      { error: 'Could not remove property' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
});
