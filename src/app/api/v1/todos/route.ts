// ============================================================
// POST /api/v1/todos — create a task (write scope).
//
// The other safe write on this surface, and the one that makes a
// read-only assistant useful: having worked out what needs doing, it
// can leave the task where the agent will actually see it instead of
// only in a chat transcript.
//
// Linked contact and property ids are re-read under the account filter
// before the insert, so a task cannot be attached to another tenant's
// record by id.
// ============================================================

import { NextResponse } from "next/server";

import { requireApiKeyAuthor, withApiKeyAuth } from "@/lib/auth/api-keys";

const PRIORITIES = ["low", "medium", "high"] as const;
const MAX_TITLE_LEN = 200;
const MAX_DESCRIPTION_LEN = 2000;

export const POST = withApiKeyAuth("write", async (ctx, req) => {
  const author = requireApiKeyAuthor(ctx);
  if (typeof author !== "string") return author;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "'title' is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LEN) {
    return NextResponse.json(
      { error: `'title' must be ${MAX_TITLE_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json(
      {
        error: `'description' must be ${MAX_DESCRIPTION_LEN} characters or fewer`,
      },
      { status: 400 },
    );
  }

  const rawPriority = typeof body?.priority === "string" ? body.priority.trim().toLowerCase() : "";
  if (rawPriority && !PRIORITIES.includes(rawPriority as (typeof PRIORITIES)[number])) {
    return NextResponse.json(
      { error: `'priority' must be one of: ${PRIORITIES.join(", ")}` },
      { status: 400 },
    );
  }

  let dueDate: string | null = null;
  if (body?.due_date !== undefined && body.due_date !== null && body.due_date !== "") {
    const parsed = new Date(String(body.due_date));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "'due_date' must be an ISO date or timestamp" },
        { status: 400 },
      );
    }
    dueDate = parsed.toISOString();
  }

  const contactId = typeof body?.contact_id === "string" ? body.contact_id : null;
  const propertyId = typeof body?.property_id === "string" ? body.property_id : null;

  for (const [table, id, label] of [
    ["contacts", contactId, "contact_id"],
    ["properties", propertyId, "property_id"],
  ] as const) {
    if (!id) continue;
    const { data } = await ctx.db
      .from(table)
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("id", id)
      .maybeSingle();
    if (!data) {
      return NextResponse.json(
        {
          error: `No ${label.replace("_id", "")} with that id in this workspace`,
          code: "not_found",
        },
        { status: 404 },
      );
    }
  }

  const { data, error } = await ctx.db
    .from("todos")
    .insert({
      account_id: ctx.accountId,
      user_id: author,
      title,
      description: description || null,
      due_date: dueDate,
      priority: rawPriority || "medium",
      completed: false,
      contact_id: contactId,
      property_id: propertyId,
    })
    .select(
      "id, title, description, due_date, priority, completed, contact_id, property_id, created_at",
    )
    .single();

  if (error || !data) {
    console.error("[POST /api/v1/todos] insert error:", error);
    return NextResponse.json({ error: "Failed to create to-do" }, { status: 500 });
  }

  return NextResponse.json({ todo: data }, { status: 201 });
});
