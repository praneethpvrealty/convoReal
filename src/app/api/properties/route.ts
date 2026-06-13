import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

// GET /api/properties
// Lists all properties for the user's account
export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("properties")
      .select("*, owner:contacts!properties_owner_contact_id_fkey(*), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(*)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/properties] Select error:", error);
      return NextResponse.json(
        { error: "Failed to fetch properties" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
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
