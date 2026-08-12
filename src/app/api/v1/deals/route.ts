// ============================================================
// GET /api/v1/deals — pipeline deals with their stage.
//
// The stage name is joined in rather than left as a `stage_id`: a
// caller asking "what's in negotiation" wants the label, and making it
// resolve the pipeline itself would cost an extra round trip per deal.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRows, type Row } from "@/lib/v1/projections";
import { enumParam, ilikeTerm, numParam } from "@/lib/v1/query";

const STATUSES = ["open", "won", "lost"] as const;

const SELECT =
  "id, title, value, currency, status, expected_close_date, notes, created_at, updated_at, " +
  "stage:pipeline_stages(id, name), " +
  "pipeline:pipelines(id, name), " +
  "contact:contacts(id, name, phone), " +
  "property:properties(id, title, location, sublocality, price)";

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const url = new URL(req.url);
  const params = parsePageParams(url);

  let query = ctx.db
    .from("deals")
    .select(SELECT, { count: "exact" })
    .eq("account_id", ctx.accountId);

  const status = enumParam(url, "status", STATUSES);
  if (status) query = query.eq("status", status);

  const pipelineId = url.searchParams.get("pipeline_id")?.trim();
  if (pipelineId) query = query.eq("pipeline_id", pipelineId);

  const stageId = url.searchParams.get("stage_id")?.trim();
  if (stageId) query = query.eq("stage_id", stageId);

  const contactId = url.searchParams.get("contact_id")?.trim();
  if (contactId) query = query.eq("contact_id", contactId);

  const minValue = numParam(url, "min_value");
  if (minValue !== null) query = query.gte("value", minValue);

  const raw = url.searchParams.get("q");
  if (raw) {
    const term = ilikeTerm(raw);
    if (term) query = query.ilike("title", `%${term}%`);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false, nullsFirst: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    console.error("[GET /api/v1/deals] query error:", error);
    return NextResponse.json({ error: "Failed to load deals" }, { status: 500 });
  }

  const items = asRows(data).map((r) => {
    return {
      id: r.id,
      title: r.title,
      value: r.value,
      currency: r.currency ?? "INR",
      status: r.status,
      expected_close_date: r.expected_close_date,
      notes: r.notes,
      stage: one(r.stage as Row | null),
      pipeline: one(r.pipeline as Row | null),
      contact: one(r.contact as Row | null),
      property: one(r.property as Row | null),
      updated_at: r.updated_at,
    };
  });

  return NextResponse.json(page(items, params, count ?? null));
});
