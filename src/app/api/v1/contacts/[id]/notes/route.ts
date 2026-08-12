// ============================================================
// GET  /api/v1/contacts/[id]/notes — this contact's note history.
// POST /api/v1/contacts/[id]/notes — append one (write scope).
//
// Notes are the safe write on this surface: they record what an agent
// or an assistant learned, and nothing downstream sends them anywhere.
// The contact is re-read under the account filter before either verb
// touches contact_notes, so a note cannot be written onto (or read
// from) another tenant's contact by id.
// ============================================================

import { NextResponse } from "next/server";

import { requireApiKeyAuthor, withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import type { ApiKeyContext } from "@/lib/auth/api-keys";

const MAX_NOTE_LEN = 5000;

async function contactExists(ctx: ApiKeyContext, id: string): Promise<boolean> {
  const { data } = await ctx.db
    .from("contacts")
    .select("id")
    .eq("account_id", ctx.accountId)
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

const notFound = () =>
  NextResponse.json({ error: "Contact not found", code: "not_found" }, { status: 404 });

export const GET = withApiKeyAuth("read", async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const params = parsePageParams(new URL(req.url));

  if (!(await contactExists(ctx, id))) return notFound();

  const { data, error, count } = await ctx.db
    .from("contact_notes")
    .select("id, note_text, created_at, user_id", { count: "exact" })
    .eq("account_id", ctx.accountId)
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    console.error("[GET /api/v1/contacts/[id]/notes] query error:", error);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }

  return NextResponse.json(page(data ?? [], params, count ?? null));
});

export const POST = withApiKeyAuth("write", async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;

  const author = requireApiKeyAuthor(ctx);
  if (typeof author !== "string") return author;

  const body = (await req.json().catch(() => null)) as {
    note?: unknown;
  } | null;
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!note) {
    return NextResponse.json({ error: "'note' is required" }, { status: 400 });
  }
  if (note.length > MAX_NOTE_LEN) {
    return NextResponse.json(
      { error: `'note' must be ${MAX_NOTE_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  if (!(await contactExists(ctx, id))) return notFound();

  const { data, error } = await ctx.db
    .from("contact_notes")
    .insert({
      account_id: ctx.accountId,
      contact_id: id,
      user_id: author,
      note_text: note,
    })
    .select("id, note_text, created_at, user_id")
    .single();

  if (error || !data) {
    console.error("[POST /api/v1/contacts/[id]/notes] insert error:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }

  return NextResponse.json({ note: data }, { status: 201 });
});
