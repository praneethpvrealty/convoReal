import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 12;

// GET /api/public/properties
// Public endpoint to fetch published and available properties for showcase with pagination
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

    // 3. Pagination params
    const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
    const from = page * limit;
    const to = from + limit - 1;

    // Optional filters
    const type = searchParams.get("type")?.trim() || "";
    const minPrice = searchParams.get("min_price");
    const maxPrice = searchParams.get("max_price");
    const location = searchParams.get("location")?.trim() || "";

    // 4. Fetch properties bypassing RLS using supabaseAdmin client
    const client = supabaseAdmin();
    let query = client
      .from("properties")
      .select("*", { count: "exact" })
      .eq("account_id", accountId)
      .eq("is_published", true)
      .eq("status", "Available")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (type) query = query.eq("type", type);
    if (location) query = query.ilike("location", `%${location}%`);
    if (minPrice) {
      const min = Number(minPrice);
      if (!isNaN(min)) query = query.gte("price", min);
    }
    if (maxPrice) {
      const max = Number(maxPrice);
      if (!isNaN(max)) query = query.lte("price", max);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("[GET /api/public/properties] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch showcase properties" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    }, {
      headers: {
        // Cache for 60s, serve stale for 5min while revalidating
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[GET /api/public/properties] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
