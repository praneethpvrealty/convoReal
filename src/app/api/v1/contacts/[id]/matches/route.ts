// ============================================================
// GET /api/v1/contacts/[id]/matches — which of this account's listings
// fit this contact, ranked best-first.
//
// The transpose of the property-matches route, and it reuses the
// transpose the buyer portal already established: `curateForBuyer`
// runs the SAME engine per property with a single-contact list, so
// what an agent's assistant reports here cannot disagree with what the
// buyer sees in their own portal.
//
// Unpublished and sold listings are excluded — an answer that leads
// with something the agent cannot transact is worse than a short list.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { curateForBuyer, hasBuyerBrief } from "@/lib/buyer/matches-ranking";
import { pageArray, parsePageParams } from "@/lib/v1/pagination";
import {
  MATCHING_CONTACT_COLUMNS,
  MATCHING_PROPERTY_COLUMNS,
  toV1Property,
} from "@/lib/v1/projections";
import { numParam } from "@/lib/v1/query";
import type { Contact, Property } from "@/types";

/** Statuses a listing can be matched from — see PROPERTY_STATUSES in
 *  src/lib/inventory/property-options.ts. 'Under Contract' stays in
 *  because a deal that has not closed is still worth a backup buyer;
 *  Sold, Archived, Off Market, Pending Review and Rejected are not
 *  things an agent can transact today. */
const MATCHABLE_STATUSES = ["Available", "Under Contract"];

/** Ranking is in-memory, so the candidate pool is bounded. Well above
 *  any single brokerage's live inventory; a tenant past this gets the
 *  most recently updated slice rather than a timeout. */
const CANDIDATE_CAP = 2000;

export const GET = withApiKeyAuth("read", async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const url = new URL(req.url);
  const params = parsePageParams(url);
  const minScore = numParam(url, "min_score");

  const { data: contact, error: contactError } = await ctx.db
    .from("contacts")
    .select(MATCHING_CONTACT_COLUMNS)
    .eq("account_id", ctx.accountId)
    .eq("id", id)
    .maybeSingle();

  if (contactError) {
    console.error("[GET /api/v1/contacts/[id]/matches] contact error:", contactError);
    return NextResponse.json({ error: "Failed to load contact" }, { status: 500 });
  }
  if (!contact) {
    return NextResponse.json({ error: "Contact not found", code: "not_found" }, { status: 404 });
  }

  // Ranking a whole inventory against an empty brief produces noise
  // ordered by nothing. Say so instead of returning it.
  if (!hasBuyerBrief(contact as unknown as Contact)) {
    return NextResponse.json({
      contact_id: id,
      items: [],
      total: 0,
      count: 0,
      offset: params.offset,
      limit: params.limit,
      has_more: false,
      next_offset: null,
      note: "This contact has no stated budget, area, project or requirement, so there is nothing to match against. Add a requirement first.",
    });
  }

  const { data: properties, error: propertiesError } = await ctx.db
    .from("properties")
    .select(MATCHING_PROPERTY_COLUMNS)
    .eq("account_id", ctx.accountId)
    .in("status", MATCHABLE_STATUSES)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_CAP);

  if (propertiesError) {
    console.error("[GET /api/v1/contacts/[id]/matches] properties error:", propertiesError);
    return NextResponse.json({ error: "Failed to load properties" }, { status: 500 });
  }

  const ranked = curateForBuyer(
    (properties ?? []) as unknown as Property[],
    contact as unknown as Contact,
    minScore === null ? {} : { minScore },
  ).map((match) => ({
    property: toV1Property(match.property),
    score: match.score,
    details: match.details,
    reasons: match.reasons,
  }));

  return NextResponse.json({
    contact_id: id,
    ...pageArray(ranked, params),
  });
});
