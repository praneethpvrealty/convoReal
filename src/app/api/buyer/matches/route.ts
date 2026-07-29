// GET /api/buyer/matches — listings matched to the buyer's own brief.
//
// Scoped through the caller's buyer_contact_links, same as every other
// /api/buyer read: curated listings come only from agencies that hold
// this buyer as a contact, and cross-tenant Deal Mode matches stay
// masked.

import { NextResponse } from 'next/server';

import { withBuyerAuth } from '@/lib/buyer/auth';
import { getBuyerMatchFeed } from '@/lib/buyer/matches';

export const GET = withBuyerAuth(async (ctx) => {
  const feed = await getBuyerMatchFeed(ctx);
  return NextResponse.json(feed);
});
