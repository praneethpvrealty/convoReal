// ============================================================
// GET  /api/v1/contacts — search this account's contacts.
// POST /api/v1/contacts — create one (write scope).
//
// `ctx.db` is the service-role client; the `.eq('account_id', …)` on
// the read and the explicit `account_id` on the insert are what keep
// this scoped to one tenant.
//
// Archived and dead contacts are excluded by default. They are
// excluded from matching, digests and automated sends (migration 230),
// so returning them here would put rows in front of an agent that no
// other surface would act on.
// ============================================================

import { NextResponse } from "next/server";

import { requireApiKeyAuthor, withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRow, asRows, CONTACT_COLUMNS, toV1Contact } from "@/lib/v1/projections";
import { boolParam, enumParam, ilikeAcross, ilikeTerm } from "@/lib/v1/query";

const SEARCH_COLUMNS = ["name", "second_name", "phone", "email", "company"];

const CLASSIFICATIONS = [
  "Owner",
  "Seller",
  "Buyer",
  "Agent",
  "Developer",
  "Owner & Buyer",
  "Others",
] as const;

const LEAD_TEMPS = ["HOT", "COLD", "Not Responding", "Dead"] as const;

const MAX_NAME_LEN = 120;
const MAX_REQUIREMENTS_LEN = 2000;

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const url = new URL(req.url);
  const params = parsePageParams(url);

  let query = ctx.db
    .from("contacts")
    .select(CONTACT_COLUMNS, { count: "exact" })
    .eq("account_id", ctx.accountId);

  if (boolParam(url, "include_archived") !== true) {
    query = query.eq("is_archived", false).eq("is_dead", false);
  }

  const raw = url.searchParams.get("q");
  if (raw) {
    const term = ilikeTerm(raw);
    if (term) query = query.or(ilikeAcross(SEARCH_COLUMNS, term));
  }

  const classification = enumParam(url, "classification", CLASSIFICATIONS);
  if (classification) query = query.eq("classification", classification);

  const leadTemp = enumParam(url, "lead_temp", LEAD_TEMPS);
  if (leadTemp) query = query.eq("lead_temp", leadTemp);

  // "Who has told us what they want" — the population worth matching.
  if (boolParam(url, "has_requirement") === true) {
    query = query.not("requirements", "is", null).eq("requirement_active", true);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false, nullsFirst: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    console.error("[GET /api/v1/contacts] query error:", error);
    return NextResponse.json({ error: "Failed to search contacts" }, { status: 500 });
  }

  return NextResponse.json(page(asRows(data).map(toV1Contact), params, count ?? null));
});

export const POST = withApiKeyAuth("write", async (ctx, req) => {
  const author = requireApiKeyAuthor(ctx);
  if (typeof author !== "string") return author;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "'name' is required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `'name' must be ${MAX_NAME_LEN} characters or fewer` },
      { status: 400 },
    );
  }
  // Phone is nullable (migration 253) for email-only records, but a
  // contact reachable by neither is not a lead.
  if (!phone && !email) {
    return NextResponse.json(
      { error: "A contact needs at least one of 'phone' or 'email'" },
      { status: 400 },
    );
  }

  const classification =
    typeof body?.classification === "string"
      ? CLASSIFICATIONS.find(
          (c) => c.toLowerCase() === body.classification!.toString().toLowerCase(),
        )
      : undefined;
  if (body?.classification !== undefined && !classification) {
    return NextResponse.json(
      {
        error: `'classification' must be one of: ${CLASSIFICATIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const requirements = typeof body?.requirements === "string" ? body.requirements.trim() : "";
  if (requirements.length > MAX_REQUIREMENTS_LEN) {
    return NextResponse.json(
      {
        error: `'requirements' must be ${MAX_REQUIREMENTS_LEN} characters or fewer`,
      },
      { status: 400 },
    );
  }

  if (phone) {
    const { data: existing } = await ctx.db
      .from("contacts")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: "A contact with this phone number already exists in this workspace.",
          code: "duplicate_contact",
          contact_id: existing.id,
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await ctx.db
    .from("contacts")
    .insert({
      account_id: ctx.accountId,
      user_id: author,
      name,
      phone: phone || null,
      email: email || null,
      classification: classification ?? "Buyer",
      requirements: requirements || null,
      source: `api_key:${ctx.keyName}`,
    })
    .select(CONTACT_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[POST /api/v1/contacts] insert error:", error);
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }

  return NextResponse.json({ contact: toV1Contact(asRow(data)) }, { status: 201 });
});
