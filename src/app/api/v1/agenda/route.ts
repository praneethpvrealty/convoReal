// ============================================================
// GET /api/v1/agenda — appointments and open to-dos in a window.
//
// One call rather than two, because "what's on for tomorrow" is one
// question and an agent asking it should not have to know the app
// keeps meetings and tasks in different tables.
//
// The window defaults to today through seven days out. Both halves are
// bounded independently and neither is paged: an agenda longer than a
// page is a scheduling problem, not a paging one, so this caps each
// list and says so rather than paginating a diary.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const MAX_ITEMS = 100;

/** Parse a YYYY-MM-DD or full ISO timestamp; null if unusable. */
function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const url = new URL(req.url);

  const from = parseDate(url.searchParams.get("from")) ?? new Date();
  let to = parseDate(url.searchParams.get("to"));
  if (!to) {
    to = new Date(from.getTime() + DEFAULT_DAYS * 86_400_000);
  }

  if (to.getTime() < from.getTime()) {
    return NextResponse.json({ error: "'to' must be on or after 'from'" }, { status: 400 });
  }

  const maxTo = new Date(from.getTime() + MAX_DAYS * 86_400_000);
  const clamped = to.getTime() > maxTo.getTime();
  if (clamped) to = maxTo;

  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [appointments, todos] = await Promise.all([
    ctx.db
      .from("appointments")
      .select(
        "id, title, description, start_time, end_time, location, status, " +
          "contact:contacts(id, name, phone), " +
          "property:properties(id, title, location, sublocality)",
      )
      .eq("account_id", ctx.accountId)
      .neq("status", "cancelled")
      .gte("start_time", fromIso)
      .lte("start_time", toIso)
      .order("start_time", { ascending: true })
      .limit(MAX_ITEMS),
    ctx.db
      .from("todos")
      .select(
        "id, title, description, due_date, priority, completed, " +
          "contact:contacts(id, name, phone), " +
          "property:properties(id, title, location, sublocality)",
      )
      .eq("account_id", ctx.accountId)
      .eq("completed", false)
      // Overdue work belongs on today's agenda, so the lower bound is
      // deliberately open — a task due last week is still outstanding.
      .lte("due_date", toIso)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(MAX_ITEMS),
  ]);

  if (appointments.error) {
    console.error("[GET /api/v1/agenda] appointments error:", appointments.error);
    return NextResponse.json({ error: "Failed to load appointments" }, { status: 500 });
  }
  if (todos.error) {
    console.error("[GET /api/v1/agenda] todos error:", todos.error);
    return NextResponse.json({ error: "Failed to load to-dos" }, { status: 500 });
  }

  const appointmentRows = appointments.data ?? [];
  const todoRows = todos.data ?? [];

  return NextResponse.json({
    from: fromIso,
    to: toIso,
    appointments: appointmentRows,
    todos: todoRows,
    truncated: {
      appointments: appointmentRows.length === MAX_ITEMS,
      todos: todoRows.length === MAX_ITEMS,
    },
    ...(clamped ? { note: `Window clamped to ${MAX_DAYS} days from 'from'.` } : {}),
  });
});
