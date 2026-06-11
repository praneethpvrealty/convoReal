import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// GET /api/public/properties
// Public endpoint to fetch published and available properties for showcase
export async function GET(request: Request) {
  try {
    // 1. Optional API Key security check
    const expectedApiKey = process.env.PUBLIC_API_KEY || process.env.WACRM_PUBLIC_API_KEY;
    if (expectedApiKey) {
      const apiKey = request.headers.get("x-api-key");
      if (apiKey !== expectedApiKey) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid API key" },
          { status: 401 }
        );
      }
    }

    // 2. Resolve account_id from query parameters or default environment variable
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id") || process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID;

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required 'account_id' query parameter" },
        { status: 400 }
      );
    }

    // 3. Fetch properties bypassing RLS using supabaseAdmin client
    const client = supabaseAdmin();
    const { data, error } = await client
      .from("properties")
      .select("*")
      .eq("account_id", accountId)
      .eq("is_published", true)
      .eq("status", "Available")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/public/properties] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch showcase properties" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/public/properties] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
