// ============================================================
// GET /api/v1/properties/[id]/matches — which of this account's
// contacts fit this listing, ranked best-first.
//
// The scoring is src/lib/matching.ts, unchanged and unreimplemented —
// the same engine the inventory screen, the share dialog and Match
// Radar run. A second scoring path here would let an agent's answer
// disagree with what the dashboard shows them.
//
// Mirrors /api/properties/[id]/matches (the session-authenticated
// twin) in what it loads and how it ranks; it differs only in
// authenticating by API key, scoping by `ctx.accountId` in code rather
// than through RLS, and returning the compact v1 contact shape.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { getMatchingContacts } from "@/lib/matching";
import { attachInquiredListingTypes } from "@/lib/contacts/inquired-intent";
import { matchReasons } from "@/lib/buyer/matches-ranking";
import { pageArray, parsePageParams } from "@/lib/v1/pagination";
import {
  MATCHING_CONTACT_COLUMNS,
  MATCHING_PROPERTY_COLUMNS,
  toV1Contact,
} from "@/lib/v1/projections";
import { numParam } from "@/lib/v1/query";
import type { Contact, Property } from "@/types";

/** Contacts who could plausibly want a listing. Sellers, developers and
 *  service contacts are not an audience — same filter as the
 *  session-authenticated matches route. */
const BUYER_CLASSIFICATIONS = ["Buyer", "Agent"];

export const GET = withApiKeyAuth("read", async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const url = new URL(req.url);
  const params = parsePageParams(url);
  const minScore = numParam(url, "min_score") ?? 0;

  const { data: property, error: propertyError } = await ctx.db
    .from("properties")
    .select(MATCHING_PROPERTY_COLUMNS)
    .eq("account_id", ctx.accountId)
    .eq("id", id)
    .maybeSingle();

  if (propertyError) {
    console.error("[GET /api/v1/properties/[id]/matches] property error:", propertyError);
    return NextResponse.json({ error: "Failed to load property" }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: "Property not found", code: "not_found" }, { status: 404 });
  }

  const { data: contacts, error: contactsError } = await ctx.db
    .from("contacts")
    .select(MATCHING_CONTACT_COLUMNS)
    .eq("account_id", ctx.accountId)
    .in("classification", BUYER_CLASSIFICATIONS);

  if (contactsError) {
    console.error("[GET /api/v1/properties/[id]/matches] contacts error:", contactsError);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
  }

  const ranked = getMatchingContacts(
    property as unknown as Property,
    await attachInquiredListingTypes(ctx.db, ctx.accountId, (contacts ?? []) as unknown as Contact[]),
  )
    .filter((result) => result.score >= minScore)
    .map((result) => ({
      contact: toV1Contact(result.contact),
      score: result.score,
      details: result.details,
      reasons: matchReasons(result.details),
    }));

  return NextResponse.json({
    property_id: id,
    ...pageArray(ranked, params),
  });
});
