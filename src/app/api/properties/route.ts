import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { autoSyncPropertyCatalogIfNeeded } from "@/lib/whatsapp/catalog-sync-helper";
import { CATEGORY_SUBTYPES, parsePropertyQuery } from "@/lib/search-parser";
import { checkPlanLimit, gateResponse } from "@/lib/billing/gates";
import { boundingBox, haversineKm } from "@/lib/geo";
import { geocodeAddress, hasGoogleMapsKey } from "@/lib/maps/google-places";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const ALLOWED_SORT_FIELDS = ["created_at", "updated_at", "title", "price", "location", "status", "is_published"] as const;
type SortField = typeof ALLOWED_SORT_FIELDS[number];

// Tiered location search: candidates fetched per tier before in-memory
// merge/sort/pagination. Generous for per-account inventory sizes.
const NEAR_SEARCH_CAP = 500;
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 50;

/** PostgREST .or() filter values break on these characters — keep the
 *  locality's primary token only (e.g. "HSR Layout" from
 *  "HSR Layout, Bengaluru, Karnataka, India"). */
function sanitizeLocalityLabel(label: string): string {
  return label.split(",")[0].replace(/[(),.]/g, " ").replace(/\s+/g, " ").trim();
}

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
    const listingType = searchParams.get("listing_type")?.trim() || "";
    const minPrice = searchParams.get("min_price");
    const maxPrice = searchParams.get("max_price");
    const sort = (ALLOWED_SORT_FIELDS.includes(searchParams.get("sort") as SortField)
      ? searchParams.get("sort")
      : "created_at") as SortField;
    const order = searchParams.get("order") === "asc" ? "asc" : "desc";

    // Tiered location search params (set when the agent picks a locality
    // from autocomplete): exact locality matches rank first, then
    // properties within radius_km sorted by distance.
    const nearLat = parseFloat(searchParams.get("near_lat") || "");
    const nearLng = parseFloat(searchParams.get("near_lng") || "");
    const hasNear = Number.isFinite(nearLat) && Number.isFinite(nearLng);
    const radiusKm = Math.min(
      MAX_RADIUS_KM,
      Math.max(0.5, parseFloat(searchParams.get("radius_km") || "") || DEFAULT_RADIUS_KM)
    );
    const nearPlaceId = searchParams.get("near_place_id")?.trim() || "";
    const nearLabel = sanitizeLocalityLabel(searchParams.get("near_label") || "");

    const from = page * limit;
    const to = from + limit - 1;

    const SELECT_COLUMNS =
      "*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification)";

    // Shared filter chain used by both the plain listing query and the
    // two tiered-location candidate queries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (query: any) => {
      if (search) {
        // Parse natural language search: "3 BHK villa in Whitefield under 2 Cr"
        const parsed = parsePropertyQuery(search);

        if (parsed.minPrice !== null) query = query.gte("price", parsed.minPrice);
        if (parsed.maxPrice !== null) query = query.lte("price", parsed.maxPrice);
        if (parsed.minArea !== null) query = query.gte("area_sqft", parsed.minArea);
        if (parsed.maxArea !== null) query = query.lte("area_sqft", parsed.maxArea);
        if (parsed.bedrooms !== null) query = query.eq("bedrooms", parsed.bedrooms);

        // Apply listing type (rent vs sale) from NL query — only if the
        // dedicated listing_type param wasn't already set via the dropdown
        if (parsed.listingType && !listingType) {
          query = query.eq("listing_type", parsed.listingType);
        }

        // Apply type filter from NL query ONLY when the dropdown type filter
        // hasn't been set — they would conflict and produce zero results otherwise.
        if (parsed.types.length > 0 && !type) {
          query = query.in("type", parsed.types);
        }

        // Apply location filter from NL query — skipped when a locality was
        // picked from autocomplete (the tiered search owns location then).
        if (!hasNear && parsed.locations.length > 0 && !parsed.remainingSearch) {
          const locFilters = parsed.locations
            .map(loc => `location.ilike.%${loc}%,sublocality.ilike.%${loc}%,city.ilike.%${loc}%`)
            .join(",");
          query = query.or(locFilters);
        }

        // Full-text fallback on remaining terms after stripping structured intent
        if (parsed.remainingSearch) {
          const term = `%${parsed.remainingSearch}%`;
          query = query.or(
            `title.ilike.${term},` +
            `location.ilike.${term},` +
            `sublocality.ilike.${term},` +
            `city.ilike.${term},` +
            `project.ilike.${term},` +
            `description.ilike.${term},` +
            `ideal_for.ilike.${term},` +
            `notes.ilike.${term},` +
            `property_code.ilike.${term}`
          );
        }
      }

      if (type) {
        if (type in CATEGORY_SUBTYPES) {
          query = query.in("type", CATEGORY_SUBTYPES[type]);
        } else {
          query = query.eq("type", type);
        }
      }

      if (status) query = query.eq("status", status);
      if (isPublished !== null && isPublished !== "") {
        query = query.eq("is_published", isPublished === "true");
      }
      if (listingSource) query = query.eq("listing_source", listingSource);
      if (listingType) query = query.eq("listing_type", listingType);

      if (minPrice !== null && minPrice !== "") {
        const min = Number(minPrice);
        if (!isNaN(min)) query = query.gte("price", min);
      }
      if (maxPrice !== null && maxPrice !== "") {
        const max = Number(maxPrice);
        if (!isNaN(max)) query = query.lte("price", max);
      }

      return query;
    };

    // ── Tiered location search path ─────────────────────────────────
    if (hasNear) {
      const box = boundingBox(nearLat, nearLng, radiusKm);

      // Tier 1 candidates: canonical place identity or locality-name match
      // (covers properties that haven't been geocoded yet).
      const exactParts: string[] = [];
      if (nearPlaceId) exactParts.push(`locality_place_id.eq.${nearPlaceId}`);
      if (nearLabel) {
        const term = `%${nearLabel}%`;
        exactParts.push(
          `locality_canonical.ilike.${term}`,
          `sublocality.ilike.${term}`,
          `location.ilike.${term}`,
          `project.ilike.${term}`
        );
      }

      // Tier 2 candidates: coordinates inside the radius bounding box.
      const nearbyQuery = applyFilters(
        ctx.supabase
          .from("properties")
          .select(SELECT_COLUMNS)
          .eq("account_id", ctx.accountId)
          .gte("latitude", box.minLat)
          .lte("latitude", box.maxLat)
          .gte("longitude", box.minLng)
          .lte("longitude", box.maxLng)
          .limit(NEAR_SEARCH_CAP)
      );

      const exactQuery = exactParts.length
        ? applyFilters(
            ctx.supabase
              .from("properties")
              .select(SELECT_COLUMNS)
              .eq("account_id", ctx.accountId)
              .or(exactParts.join(","))
              .limit(NEAR_SEARCH_CAP)
          )
        : Promise.resolve({ data: [], error: null });

      const [exactRes, nearbyRes] = await Promise.all([exactQuery, nearbyQuery]);
      const queryError = exactRes.error || nearbyRes.error;
      if (queryError) {
        console.error("[GET /api/properties] Near-search select error:", queryError);
        return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
      }

      const nearLabelLc = nearLabel.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byId = new Map<string, any>();
      for (const row of [...(exactRes.data || []), ...(nearbyRes.data || [])]) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tiered = [...byId.values()].flatMap((row: any) => {
        const hasCoords = row.latitude != null && row.longitude != null;
        const distanceKm = hasCoords
          ? haversineKm(nearLat, nearLng, Number(row.latitude), Number(row.longitude))
          : null;

        const isExact =
          (nearPlaceId && row.locality_place_id === nearPlaceId) ||
          (nearLabelLc &&
            [row.locality_canonical, row.sublocality, row.location, row.project].some(
              (f: string | null) => f && f.toLowerCase().includes(nearLabelLc)
            ));

        if (!isExact && (distanceKm === null || distanceKm > radiusKm)) return [];

        return [{
          ...row,
          distance_km: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
          location_tier: isExact ? "exact" : "nearby",
        }];
      });

      tiered.sort((a, b) => {
        if (a.location_tier !== b.location_tier) {
          return a.location_tier === "exact" ? -1 : 1;
        }
        const da = a.distance_km ?? Number.POSITIVE_INFINITY;
        const db = b.distance_km ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return String(b.created_at).localeCompare(String(a.created_at));
      });

      const total = tiered.length;
      return NextResponse.json({
        data: tiered.slice(from, from + limit),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    // ── Plain listing path (unchanged behavior) ─────────────────────
    const query = applyFilters(
      ctx.supabase
        .from("properties")
        .select(SELECT_COLUMNS, { count: "exact" })
        .eq("account_id", ctx.accountId)
        .order(sort, { ascending: order === "asc" })
        .range(from, to)
    );

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

    // Plan gate: Starter plan is limited to 10 properties
    const gate = await checkPlanLimit(ctx, "properties");
    if (!gate.allowed) return gateResponse(gate);

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
      // rental fields
      listing_type,
      rent_per_month,
      maintenance,
      advance,
      gst,
      notes,
      // locality coordinates (from the form's Places autocomplete pick)
      latitude,
      longitude,
      locality_place_id,
      locality_canonical,
    } = body;

    // Validation
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "'title' is required and must be a string" },
        { status: 400 }
      );
    }

    const parsedListingType = listing_type === "Rent" ? "Rent" : "Sale";
    let parsedPrice = price;
    if (parsedListingType === "Rent" && (parsedPrice === undefined || parsedPrice === null)) {
      parsedPrice = rent_per_month || 0;
    }

    if (typeof parsedPrice !== "number" || parsedPrice < 0) {
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
      price: parsedPrice,
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
      listing_type: parsedListingType,
      rent_per_month: typeof rent_per_month === "number" ? rent_per_month : null,
      maintenance: typeof maintenance === "number" ? maintenance : null,
      advance: typeof advance === "number" ? advance : null,
      gst: typeof gst === "number" ? gst : null,
      notes: typeof notes === "string" ? notes.trim() || null : null,
      latitude: typeof latitude === "number" && Number.isFinite(latitude) ? latitude : null,
      longitude: typeof longitude === "number" && Number.isFinite(longitude) ? longitude : null,
      locality_place_id:
        typeof locality_place_id === "string" ? locality_place_id.trim() || null : null,
      locality_canonical:
        typeof locality_canonical === "string" ? locality_canonical.trim() || null : null,
    };

    // Best-effort geocode when the location was typed rather than picked
    // from autocomplete (e.g. WhatsApp-intake listings) so radius search
    // covers these properties too. Never blocks the save on failure.
    if (insertData.latitude === null && insertData.location && hasGoogleMapsKey()) {
      try {
        const geo = await geocodeAddress(
          [insertData.location, insertData.city, insertData.state].filter(Boolean).join(", ")
        );
        if (geo) {
          insertData.latitude = geo.latitude;
          insertData.longitude = geo.longitude;
          insertData.locality_place_id = insertData.locality_place_id || geo.place_id;
        }
      } catch (geoErr) {
        console.warn("[POST /api/properties] Geocode fallback failed:", geoErr);
      }
    }

    const { data, error } = await ctx.supabase
      .from("properties")
      .insert(insertData)
      .select("*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification)")
      .single();

    if (error) {
      console.error("[POST /api/properties] Insert error:", error);
      return NextResponse.json(
        { error: "Failed to create property" },
        { status: 500 }
      );
    }

    if (data && data.id) {
      autoSyncPropertyCatalogIfNeeded(ctx.supabase, data.id, ctx.accountId).catch((err) => {
        console.error("[POST /api/properties] Auto-sync background error:", err);
      });
      // Match Radar: surface matching buyers for the new listing
      // (fire-and-forget; match_events INSERT needs the service role).
      import("@/lib/radar/engine")
        .then(({ generateMatchEventForProperty, radarAdminClient }) =>
          generateMatchEventForProperty(radarAdminClient(), ctx.accountId, data.id)
        )
        .catch((err) => {
          console.error("[POST /api/properties] Radar background error:", err);
        });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
