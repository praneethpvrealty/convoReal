import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const ALLOWED_SORT_FIELDS = ["created_at", "updated_at", "title", "price", "location", "status", "is_published"] as const;
type SortField = typeof ALLOWED_SORT_FIELDS[number];

// GET /api/properties
// Lists properties for the user's account with pagination and filtering
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const { searchParams } = new URL(request.url);

    const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
    const search = searchParams.get("search")?.trim() || "";
    const type = searchParams.get("type")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "";
    const isPublished = searchParams.get("is_published");
    const listingSource = searchParams.get("listing_source")?.trim() || "";
    const minPrice = searchParams.get("min_price");
    const maxPrice = searchParams.get("max_price");
    const sort = (ALLOWED_SORT_FIELDS.includes(searchParams.get("sort") as SortField)
      ? searchParams.get("sort")
      : "created_at") as SortField;
    const order = searchParams.get("order") === "asc" ? "asc" : "desc";

    const from = page * limit;
    const to = from + limit - 1;

    let query = ctx.supabase
      .from("properties")
      .select("*, owner:contacts!properties_owner_contact_id_fkey(*)", { count: "exact" })
      .eq("account_id", ctx.accountId)
      .order(sort, { ascending: order === "asc" })
      .range(from, to);

    if (search) {
      const term = `%${search}%`;
      query = query.or(`title.ilike.${term},location.ilike.${term},project.ilike.${term},description.ilike.${term},property_code.ilike.${term}`);
    }

    if (type) {
      query = query.eq("type", type);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (isPublished !== null && isPublished !== "") {
      query = query.eq("is_published", isPublished === "true");
    }

    if (listingSource) {
      query = query.eq("listing_source", listingSource);
    }

    if (minPrice !== null && minPrice !== "") {
      const min = Number(minPrice);
      if (!isNaN(min)) query = query.gte("price", min);
    }

    if (maxPrice !== null && maxPrice !== "") {
      const max = Number(maxPrice);
      if (!isNaN(max)) query = query.lte("price", max);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("[GET /api/properties] Select error:", error);
      return NextResponse.json(
        { error: "Failed to fetch properties" },
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
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/properties
// Creates a new property listing
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    // Rate limiting to prevent abuse
    const limit = checkRateLimit(
      `agent:createProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction // Re-use standard admin rate limits
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const {
      title,
      description,
      price,
      location,
      type,
      status,
      bedrooms,
      bathrooms,
      area_sqft,
      area_unit,
      land_area,
      land_area_unit,
      super_built_area,
      sublocality,
      city,
      state,
      project,
      is_published,
      features,
      images,
      land_zone,
      ideal_for,
      dimensions,
      road_width,
      road_width_unit,
      facing_direction,
      nearby_highlights,
      owner_contact_id,
      google_map_link,
      rental_income,
      roi,
      listing_source,
    } = body;

    // Validation
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "'title' is required and must be a string" },
        { status: 400 }
      );
    }

    if (typeof price !== "number" || price < 0) {
      return NextResponse.json(
        { error: "'price' is required and must be a non-negative number" },
        { status: 400 }
      );
    }

    if (typeof location !== "string" || location.trim().length === 0) {
      return NextResponse.json(
        { error: "'location' is required and must be a string" },
        { status: 400 }
      );
    }

    if (typeof type !== "string" || type.trim().length === 0) {
      return NextResponse.json(
        { error: "'type' is required and must be a string" },
        { status: 400 }
      );
    }

    const validStatus = typeof status === "string" && status.trim().length > 0 ? status.trim() : "Available";

    const insertData = {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      title: title.trim(),
      description: typeof description === "string" ? description.trim() : null,
      price,
      location: location.trim(),
      type: type.trim(),
      status: validStatus,
      bedrooms: typeof bedrooms === "number" ? bedrooms : null,
      bathrooms: typeof bathrooms === "number" ? bathrooms : null,
      area_sqft: typeof area_sqft === "number" ? area_sqft : null,
      area_unit: typeof area_unit === "string" ? area_unit.trim() : "Sq.Ft.",
      land_area: typeof land_area === "number" ? land_area : null,
      land_area_unit: typeof land_area_unit === "string" ? land_area_unit.trim() : "Sq.Ft.",
      super_built_area: typeof super_built_area === "number" ? super_built_area : null,
      sublocality: typeof sublocality === "string" ? sublocality.trim() : null,
      city: typeof city === "string" ? city.trim() : null,
      state: typeof state === "string" ? state.trim() : null,
      project: typeof project === "string" ? project.trim() : null,
      land_zone: typeof land_zone === "string" ? land_zone.trim() : null,
      ideal_for: typeof ideal_for === "string" ? ideal_for.trim() : null,
      dimensions: typeof dimensions === "string" ? dimensions.trim() : null,
      road_width: typeof road_width === "number" ? road_width : null,
      road_width_unit: typeof road_width_unit === "string" ? road_width_unit.trim() : "Feet",
      facing_direction: typeof facing_direction === "string" ? facing_direction.trim() : null,
      nearby_highlights: Array.isArray(nearby_highlights) ? nearby_highlights.filter(h => typeof h === "string") : [],
      owner_contact_id: typeof owner_contact_id === "string" && owner_contact_id.trim().length > 0 ? owner_contact_id.trim() : null,
      is_published: typeof is_published === "boolean" ? is_published : false,
      features: Array.isArray(features) ? features.filter(f => typeof f === "string") : [],
      images: Array.isArray(images) ? images.filter(img => typeof img === "string") : [],
      google_map_link: typeof google_map_link === "string" ? google_map_link.trim() : null,
      rental_income: typeof rental_income === "number" ? rental_income : null,
      roi: typeof roi === "number" ? roi : null,
      listing_source: listing_source === "agent" ? "agent" : "owner",
    };

    const { data, error } = await ctx.supabase
      .from("properties")
      .insert(insertData)
      .select("*, owner:contacts!properties_owner_contact_id_fkey(*), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(*)")
      .single();

    if (error) {
      console.error("[POST /api/properties] Insert error:", error);
      return NextResponse.json(
        { error: "Failed to create property" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
