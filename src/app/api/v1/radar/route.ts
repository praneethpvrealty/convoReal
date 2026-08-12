// ============================================================
// GET /api/v1/radar — Match Radar events.
//
// Each event is a snapshot the engine computed when a listing landed
// or a buyer's brief changed: the subject on one side, the ranked
// counterparties in `matches`. Snapshots are not recomputed on read
// (migration 094), so this is a cheap "what needs my attention" feed
// rather than a live re-score — use /properties/[id]/matches or
// /contacts/[id]/matches for a fresh ranking.
//
// deal_mode events are excluded. Their subject property belongs to
// ANOTHER tenant and is only legible through the masked snapshot in
// src/lib/den/masking.ts; serving them raw through a general-purpose
// key would hand out cross-tenant inventory this surface has no
// business exposing.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRows, type Row } from "@/lib/v1/projections";
import { enumParam } from "@/lib/v1/query";

const STATUSES = ["new", "sent", "dismissed"] as const;
const KINDS = ["new_property", "buyer_updated"] as const;

const SELECT =
  "id, kind, status, matches, sent_count, sent_at, created_at, " +
  "property:properties(id, title, location, sublocality, city, price, type, listing_type), " +
  "contact:contacts(id, name, phone, classification, min_budget, max_budget)";

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const url = new URL(req.url);
  const params = parsePageParams(url);

  // Unresolved events are the useful default — the feed exists to
  // surface what nobody has acted on yet.
  const status = enumParam(url, "status", STATUSES) ?? "new";
  const kind = enumParam(url, "kind", KINDS);

  let query = ctx.db
    .from("match_events")
    .select(SELECT, { count: "exact" })
    .eq("account_id", ctx.accountId)
    .neq("source", "deal_mode")
    .eq("status", status);

  if (kind) query = query.eq("kind", kind);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    console.error("[GET /api/v1/radar] query error:", error);
    return NextResponse.json({ error: "Failed to load radar events" }, { status: 500 });
  }

  const items = asRows(data).map((r) => {
    const property = one(r.property as Row | null);
    const contact = one(r.contact as Row | null);
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      created_at: r.created_at,
      sent_count: r.sent_count,
      sent_at: r.sent_at,
      subject:
        r.kind === "new_property"
          ? { type: "property", ...(property ?? {}) }
          : { type: "contact", ...(contact ?? {}) },
      matches: Array.isArray(r.matches) ? r.matches : [],
    };
  });

  return NextResponse.json(page(items, params, count ?? null));
});
