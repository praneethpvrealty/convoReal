import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { CATEGORY_SUBTYPES, parsePropertyQuery } from "@/lib/search-parser";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { storagePublicUrl } from "@/lib/storage/url";
import { toPublicListingView } from "@/lib/inventory/showcase-visibility";
import type { Property } from "@/types";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 12;

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

// GET /api/public/properties
// Public endpoint to fetch published and available properties for showcase with pagination
export async function GET(request: Request) {
  try {
    // 1. Per-IP budget. Runs before the API-key check so an unauthenticated
    //    flood is rejected cheaply and key guessing is bounded.
    const ipLimit = checkRateLimit(
      `public-catalog:ip:${getClientIp(request)}`,
      RATE_LIMITS.publicCatalog
    );
    if (!ipLimit.success) return rateLimitResponse(ipLimit);

    // 2. Optional API Key security check
    const expectedApiKey = process.env.PUBLIC_API_KEY;
    if (expectedApiKey) {
      const apiKey = request.headers.get("x-api-key");
      if (apiKey !== expectedApiKey) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid API key" },
          { status: 401 }
        );
      }
    }

    // 3. Resolve account_id from query parameters or default environment variable
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id") || process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID;

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required 'account_id' query parameter" },
        { status: 400 }
      );
    }

    // 4. Per-account budget. The per-IP check above does nothing against a
    //    distributed scrape of one brokerage's inventory; this bounds it.
    const accountLimit = checkRateLimit(
      `public-catalog:account:${accountId}`,
      RATE_LIMITS.publicCatalogAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    // 5. Pagination params
    const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
    const from = page * limit;
    const to = from + limit - 1;

    // Optional filters
    const type = searchParams.get("type")?.trim() || "";
    const minPrice = searchParams.get("min_price");
    const maxPrice = searchParams.get("max_price");
    const location = searchParams.get("location")?.trim() || "";
    const search = searchParams.get("search")?.trim() || "";

    // 6. Fetch properties bypassing RLS using supabaseAdmin client
    const client = supabaseAdmin();
    // NOTE: 'documents' is intentionally excluded — documents are private and
    // only accessible via approved share links (/docs/[token]). Rows are
    // reduced through toPublicListingView, which withholds the exact
    // address and map pin for location-guarded properties.
    const PUBLIC_PROPERTY_COLUMNS = [
      "id", "account_id", "title", "description", "price",
      "location", "sublocality", "city", "state", "type", "status",
      "listing_type", "location_privacy", "showcase_visibility",
      "bedrooms", "bathrooms",
      "area_sqft", "area_unit",
      "land_area", "land_area_unit", "super_built_area", "project",
      "land_zone", "ideal_for", "dimensions", "road_width", "road_width_unit",
      "facing_direction", "nearby_highlights", "is_published", "features",
      "images", "google_map_link", "property_code",
      "rental_income", "roi", "listing_source", "rent_per_month",
      "maintenance", "advance", "gst", "jv_structure", "owner_share_percent",
      "builder_share_percent", "goodwill_amount", "bts_lease_years",
      "bts_lock_in_years", "bts_escalation_percent", "like_count",
      "rating_count", "rating_total",
      "created_at", "updated_at",
    ].join(", ");

    let query = client
      .from("properties")
      .select(PUBLIC_PROPERTY_COLUMNS, { count: "exact" })
      .eq("account_id", accountId)
      .eq("is_published", true)
      .eq("status", "Available")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (type) {
      if (type in CATEGORY_SUBTYPES) {
        query = query.in("type", CATEGORY_SUBTYPES[type]);
      } else {
        query = query.eq("type", type);
      }
    }
    if (location) query = query.ilike("location", `%${location}%`);
    if (minPrice) {
      const min = Number(minPrice);
      if (!isNaN(min)) query = query.gte("price", min);
    }
    if (maxPrice) {
      const max = Number(maxPrice);
      if (!isNaN(max)) query = query.lte("price", max);
    }
    if (search) {
      const parsed = parsePropertyQuery(search);
      if (parsed.minPrice !== null) query = query.gte("price", parsed.minPrice);
      if (parsed.maxPrice !== null) query = query.lte("price", parsed.maxPrice);
      if (parsed.types.length > 0) query = query.in("type", parsed.types);
      if (parsed.rentYielding) query = query.or("rental_income.gt.0,roi.gt.0");
      if (parsed.listingSource) query = query.eq("listing_source", parsed.listingSource);
      if (parsed.remainingSearch) {
        const escaped = parsed.remainingSearch.replace(/[\\"]/g, '\\$&');
        const term = `"%${escaped}%"`;
        query = query.or(`title.ilike.${term},location.ilike.${term},sublocality.ilike.${term},city.ilike.${term},project.ilike.${term},property_code.ilike.${term}`);
      }
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("[GET /api/public/properties] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch showcase properties" },
        { status: 500 }
      );
    }

    const resolved = ((data ?? []) as unknown as Property[]).map((row) => {
      const view = toPublicListingView(row, { revealExact: true });
      return {
        ...view,
        images: Array.isArray(view.images)
          ? view.images.map(storagePublicUrl)
          : view.images,
      };
    });

    return NextResponse.json({
      data: resolved,
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
