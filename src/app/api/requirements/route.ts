import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("contacts")
      .select(`
        *,
        contact_notes (*),
        conversations (id),
        contact_tags (
          id,
          tag_id,
          tags (*)
        )
      `)
      .eq("account_id", ctx.accountId)
      .in("classification", ["Buyer", "Agent"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/requirements] DB select error:", error);
      return NextResponse.json(
        { error: "Failed to fetch requirements" },
        { status: 500 }
      );
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("[GET /api/requirements] Unexpected error:", err);
    return toErrorResponse(err);
  }
}
