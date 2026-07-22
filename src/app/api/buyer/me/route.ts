// GET /api/buyer/me — the buyer's identity + linked agencies.

import { NextResponse } from 'next/server';

import { withBuyerAuth, buyerAdmin } from '@/lib/buyer/auth';

export const GET = withBuyerAuth(async (ctx) => {
  const { count } = await buyerAdmin()
    .from('buyer_shortlist_items')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_user_id', ctx.buyerUserId);

  return NextResponse.json({
    buyer_user_id: ctx.buyerUserId,
    phone: ctx.phone,
    display_name: ctx.displayName,
    notify_matches: ctx.notifyMatches,
    links: ctx.links.map((l) => ({
      account_id: l.accountId,
      contact_id: l.contactId,
      agency_name: l.agencyName,
    })),
    shortlist_count: count ?? 0,
  });
});
