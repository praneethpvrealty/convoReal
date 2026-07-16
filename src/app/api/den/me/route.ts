// GET /api/den/me — the Den user's identity + linked agencies.

import { NextResponse } from "next/server";

import { withDenAuth, resolveOwnerPropertyIds } from "@/lib/den/auth";

export const GET = withDenAuth(async (ctx) => {
  const propertyIds = await resolveOwnerPropertyIds(ctx);
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
  });
});
