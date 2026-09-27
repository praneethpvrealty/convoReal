// GET /api/den/me — the Den user's identity + linked agencies.

import { NextResponse } from "next/server";

import { withDenAuth, resolveOwnerPropertyIds, denAdmin } from "@/lib/den/auth";
import { denSellerPages } from "@/lib/den/seller-pages";

export const GET = withDenAuth(async (ctx) => {
  const [propertyIds, sellerPages] = await Promise.all([
    resolveOwnerPropertyIds(ctx),
    denSellerPages(denAdmin(), ctx.denUserId, ctx.links),
  ]);
  return NextResponse.json({
    den_user_id: ctx.denUserId,
    phone: ctx.phone,
    display_name: ctx.displayName,
    notify_matches: ctx.notifyMatches,
    notify_bids: ctx.notifyBids,
    digest_frequency: ctx.digestFrequency,
    links: ctx.links.map((l) => ({
      account_id: l.accountId,
      contact_id: l.contactId,
      agency_name: l.agencyName,
    })),
    property_count: propertyIds.length,
    seller_pages: sellerPages,
  });
});
