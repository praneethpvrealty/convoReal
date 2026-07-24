import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { autoSyncPropertyCatalogIfNeeded } from "@/lib/whatsapp/catalog-sync-helper";
import { CATEGORY_SUBTYPES, parsePropertyQuery } from "@/lib/search-parser";
import { checkPlanLimit, gateResponse } from "@/lib/billing/gates";
import { boundingBox, haversineKm } from "@/lib/geo";
import { localityStemProbe, textContainsLocality } from "@/lib/locality-match";
import { geocodeAddress, hasGoogleMapsKey } from "@/lib/maps/google-places";
import { sanitizeFloorTenancies } from "@/lib/inventory/floor-tenancies";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const ALLOWED_SORT_FIELDS = ["created_at", "updated_at", "title", "price", "location", "status", "is_published"] as const;
type SortField = typeof ALLOWED_SORT_FIELDS[number];

// Tiered location search: candidates fetched per tier before in-memory
// merge/sort/pagination. Generous for per-account inventory sizes.
const NEAR_SEARCH_CAP = 500;
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 50;

// Rows without stored coordinates are invisible to the bounding-box
// tier no matter how close they physically are, so near-search geocodes
// a bounded batch of them on the fly (and persists the result).
const GEOCODE_FALLBACK_CAP = 20;

// Price-bounded searches imply buy/rent intent — JV/JD deals are priced
// in share percentages, not a sale amount — unless the query itself
// asks for JV/JD listings.
const JV_INTENT = /\bjv\b|\bjd\b|\bjoint\s*(?:venture|development)\b/i;

/** PostgREST .or() filter values break on these characters — keep the
 *  locality's primary token only (e.g. "HSR Layout" from
 *  "HSR Layout, Bengaluru, Karnataka, India"). */
function sanitizeLocalityLabel(label: string): string {
  return label.split(",")[0].replace(/[(),.]/g, " ").replace(/\s+/g, " ").trim();
}

/** land_area_unit values (property-form AREA_UNITS) → sqft factor,
 *  matching the conversions in search-parser.ts. */
const LAND_UNIT_TO_SQFT: Record<string, number> = {
  "Sq.Ft.": 1,
  "Sq.Mtr.": 10.764,
  "Acre": 43_560,
  "Gunta": 1_089,
  "Cent": 435.6,
  "Ground": 2_400,
};

/**
 * Area bound as a PostgREST .or() expression. Land/JV listings store
 * their size in land_area + land_area_unit (area_sqft is often NULL for
 * them), so comparing area_sqft alone silently drops every plot from
 * "> 30000 sqft" searches. Units are heterogeneous per row, so the
 * sqft threshold is pre-converted into each known unit and paired with
 * an exact unit match.
 */
function areaFilter(op: "gte" | "lte", sqft: number): string {
  const branches = [`area_sqft.${op}.${sqft}`];
  for (const [unit, factor] of Object.entries(LAND_UNIT_TO_SQFT)) {
    const threshold = +(sqft / factor).toFixed(4);
    branches.push(`and(land_area_unit.eq."${unit}",land_area.${op}.${threshold})`);
  }
  return branches.join(",");
}

/**
 * Best-effort on-the-fly geocode for near-search candidates that have
 * no stored coordinates. Successful lookups are persisted (RLS
 * permitting) so each row is geocoded at most once; failures leave the
 * row name-match-only, exactly as before.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function geocodeRowsOnTheFly(supabase: any, rows: any[]): Promise<any[]> {
  return Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.map(async (row: any) => {
      const address = [row.location, row.city, row.state]
        .filter((part: unknown) => typeof part === "string" && part.trim())
        .join(", ");
      if (!address) return row;
      try {
        const geo = await geocodeAddress(address);
        if (!geo) return row;
        await supabase
          .from("properties")
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            locality_place_id: row.locality_place_id || geo.place_id,
          })
          .eq("id", row.id);
        return { ...row, latitude: geo.latitude, longitude: geo.longitude };
      } catch (err) {
        console.warn("[GET /api/properties] On-the-fly geocode failed:", err);
        return row;
      }
    })
  );
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
    const excludeArchived = searchParams.get("exclude_archived") === "true";
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
      "*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification, name_tag), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification, name_tag)";

    // Shared filter chain used by both the plain listing query and the
    // two tiered-location candidate queries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (query: any) => {
      let priceBounded = false;
      if (search) {
        // Parse natural language search: "3 BHK villa in Whitefield under 2 Cr"
        const parsed = parsePropertyQuery(search);

        if (parsed.minPrice !== null) { query = query.gte("price", parsed.minPrice); priceBounded = true; }
        if (parsed.maxPrice !== null) { query = query.lte("price", parsed.maxPrice); priceBounded = true; }
        if (parsed.minArea !== null) query = query.or(areaFilter("gte", parsed.minArea));
        if (parsed.maxArea !== null) query = query.or(areaFilter("lte", parsed.maxArea));
        if (parsed.bedrooms !== null) query = query.eq("bedrooms", parsed.bedrooms);

        // Apply listing type (rent vs sale) from NL query — only if the
        // dedicated listing_type param wasn't already set via the dropdown
        if (parsed.listingType && !listingType) {
          query = query.eq("listing_type", parsed.listingType);
        }

        if (parsed.rentYielding) {
          query = query.or("rental_income.gt.0,roi.gt.0");
        }

        // Apply listing source (owner vs agent) from NL query — the dropdown
        // param wins, same as listing type above.
        if (parsed.listingSource && !listingSource) {
          query = query.eq("listing_source", parsed.listingSource);
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
            // Probe the locality stem too, so "in Suryanagar" also
            // matches rows stored as "Surya Nagar" / "Surya City".
            .flatMap(loc => {
              const stem = localityStemProbe(loc);
              return stem ? [loc, stem] : [loc];
            })
            .map(loc => {
              const clean = loc.replace(/"/g, '\\"');
              return `location.ilike."%${clean}%",sublocality.ilike."%${clean}%",city.ilike."%${clean}%"`;
            })
            .join(",");
          query = query.or(locFilters);
        }

        // Full-text fallback on remaining terms after stripping structured intent
        if (parsed.remainingSearch) {
          const term = `"%${parsed.remainingSearch.replace(/"/g, '\\"')}%"`;
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
      if (excludeArchived) {
        if (status) throw new Error("Cannot combine status and exclude_archived");
        query = query.neq("status", "Archived");
      }
      if (isPublished !== null && isPublished !== "") {
        query = query.eq("is_published", isPublished === "true");
      }
      if (listingSource) query = query.eq("listing_source", listingSource);
      if (listingType) query = query.eq("listing_type", listingType);

      if (minPrice !== null && minPrice !== "") {
        const min = Number(minPrice);
        if (!isNaN(min)) { query = query.gte("price", min); priceBounded = true; }
      }
      if (maxPrice !== null && maxPrice !== "") {
        const max = Number(maxPrice);
        if (!isNaN(max)) { query = query.lte("price", max); priceBounded = true; }
      }

      // JV/JD listings save with a nominal price of 0 when no project
      // value is known (see POST below), so any max-price bound would
      // surface every JV deal. Keep them — and other rows with no
      // recorded price — out of price-bounded searches unless the
      // caller filtered to JV/JD or asked for JV in the query itself.
      if (priceBounded && listingType !== "JV/JD" && !JV_INTENT.test(search)) {
        query = query.neq("listing_type", "JV/JD").gt("price", 0);
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
        // Fetch by the raw label plus its locality stem ("Suryanagar" →
        // "surya", which also catches "Surya City" rows). Over-fetch is
        // fine — textContainsLocality gates what counts as exact below.
        const probes = [nearLabel];
        const stem = localityStemProbe(nearLabel);
        if (stem) probes.push(stem);
        for (const probe of probes) {
          const term = `%${probe}%`;
          exactParts.push(
            `locality_canonical.ilike.${term}`,
            `sublocality.ilike.${term}`,
            `location.ilike.${term}`,
            `project.ilike.${term}`
          );
        }
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

      // Tier 3 candidates: rows that were never geocoded (intake saved
      // without a Maps key, geocode failure, pre-backfill data) can never
      // appear in the bounding-box tier however close they physically
      // are. Geocode a bounded batch on the fly and persist the coords
      // so the radius search self-heals over time.
      const ungeocodedQuery = hasGoogleMapsKey()
        ? applyFilters(
            ctx.supabase
              .from("properties")
              .select(SELECT_COLUMNS)
              .eq("account_id", ctx.accountId)
              .is("latitude", null)
              .not("location", "is", null)
              .limit(GEOCODE_FALLBACK_CAP)
          )
        : Promise.resolve({ data: [], error: null });

      const [exactRes, nearbyRes, ungeocodedRes] = await Promise.all([
        exactQuery,
        nearbyQuery,
        ungeocodedQuery,
      ]);
      const queryError = exactRes.error || nearbyRes.error;
      if (queryError) {
        console.error("[GET /api/properties] Near-search select error:", queryError);
        return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
      }

      // The healing tier is best-effort — a failure here must not take
      // down the whole search.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let geocodedRows: any[] = [];
      if (ungeocodedRes.error) {
        console.warn("[GET /api/properties] Ungeocoded-tier select error:", ungeocodedRes.error);
      } else if ((ungeocodedRes.data || []).length > 0) {
        geocodedRows = await geocodeRowsOnTheFly(ctx.supabase, ungeocodedRes.data || []);
      }

      // Geocoded rows go first so their freshly resolved coordinates win
      // over the coordinate-less duplicates from the exact tier.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byId = new Map<string, any>();
      for (const row of [...geocodedRows, ...(exactRes.data || []), ...(nearbyRes.data || [])]) {
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
          (nearLabel &&
            [row.locality_canonical, row.sublocality, row.location, row.project].some(
              (f: string | null) => f && textContainsLocality(f, nearLabel)
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
      floor_tenancies,
      listing_source,
      // rental fields
      listing_type,
      rent_per_month,
      maintenance,
      advance,
      gst,
      // JV/JD deal terms
      jv_structure,
      owner_share_percent,
      builder_share_percent,
      goodwill_amount,
      // Built to Suit lease terms
      bts_lease_years,
      bts_lock_in_years,
      bts_escalation_percent,
      // Land/JV deal notes (internal only)
      ownership_status,
      land_use_zoning,
      deal_remarks,
      notes,
      documents,
      // locality coordinates (from the form's Places autocomplete pick)
      latitude,
      longitude,
      locality_place_id,
      locality_canonical,
      interested_contact_ids,
    } = body;

    // Validation
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "'title' is required and must be a string" },
        { status: 400 }
      );
    }

    const VALID_LISTING_TYPES = ["Sale", "Rent", "JV/JD", "Built to Suit"];
    const parsedListingType = VALID_LISTING_TYPES.includes(listing_type) ? listing_type : "Sale";
    const isRentLike = parsedListingType === "Rent" || parsedListingType === "Built to Suit";
    let parsedPrice = price;
    if (isRentLike && (parsedPrice === undefined || parsedPrice === null)) {
      parsedPrice = rent_per_month || 0;
    }
    // JV/JD's project value is optional — a price band isn't always known upfront.
    if (parsedListingType === "JV/JD" && (parsedPrice === undefined || parsedPrice === null)) {
      parsedPrice = 0;
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
      ownership_status: typeof ownership_status === "string" ? ownership_status.trim() || null : null,
      land_use_zoning: typeof land_use_zoning === "string" ? land_use_zoning.trim() || null : null,
      deal_remarks: typeof deal_remarks === "string" ? deal_remarks.trim() || null : null,
      dimensions: typeof dimensions === "string" ? dimensions.trim() : null,
      road_width: typeof road_width === "number" ? road_width : null,
      road_width_unit: typeof road_width_unit === "string" ? road_width_unit.trim() : "Feet",
      facing_direction: typeof facing_direction === "string" ? facing_direction.trim() : null,
      nearby_highlights: Array.isArray(nearby_highlights) ? nearby_highlights.filter(h => typeof h === "string") : [],
      owner_contact_id: typeof owner_contact_id === "string" && owner_contact_id.trim().length > 0 ? owner_contact_id.trim() : null,
      is_published: typeof is_published === "boolean" ? is_published : false,
      features: Array.isArray(features) ? features.filter(f => typeof f === "string") : [],
      images: Array.isArray(images) ? images.filter(img => typeof img === "string") : [],
      documents: Array.isArray(documents) ? documents.filter(d => typeof d === "string") : [],
      google_map_link: typeof google_map_link === "string" ? google_map_link.trim() : null,
      rental_income: typeof rental_income === "number" ? rental_income : null,
      roi: typeof roi === "number" ? roi : null,
      floor_tenancies: sanitizeFloorTenancies(floor_tenancies),
      listing_source: listing_source === "agent" ? "agent" : "owner",
      listing_type: parsedListingType,
      rent_per_month: typeof rent_per_month === "number" ? rent_per_month : null,
      maintenance: typeof maintenance === "number" ? maintenance : null,
      advance: typeof advance === "number" ? advance : null,
      gst: typeof gst === "number" ? gst : null,
      jv_structure: ["Revenue Share", "Area Share", "Hybrid"].includes(jv_structure) ? jv_structure : null,
      owner_share_percent: typeof owner_share_percent === "number" ? owner_share_percent : null,
      builder_share_percent: typeof builder_share_percent === "number" ? builder_share_percent : null,
      goodwill_amount: typeof goodwill_amount === "number" ? goodwill_amount : null,
      bts_lease_years: typeof bts_lease_years === "number" ? bts_lease_years : null,
      bts_lock_in_years: typeof bts_lock_in_years === "number" ? bts_lock_in_years : null,
      bts_escalation_percent: typeof bts_escalation_percent === "number" ? bts_escalation_percent : null,
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

    const { data: rawData, error: insertError } = await ctx.supabase
      .from("properties")
      .insert(insertData)
      .select("id")
      .single();

    if (insertError || !rawData) {
      console.error("[POST /api/properties] Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create property" },
        { status: 500 }
      );
    }

    if (interested_contact_ids !== undefined) {
      const interestedContactIds = Array.isArray(interested_contact_ids) ? interested_contact_ids : [];

      // Link the new ones
      if (interestedContactIds.length > 0) {
        await ctx.supabase
          .from("contacts")
          .update({ last_inquired_property_id: rawData.id })
          .in("id", interestedContactIds);
      }
    }

    // Fetch the final created property with relations
    const { data: finalData, error: fetchError } = await ctx.supabase
      .from("properties")
      .select("*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification, name_tag), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification, name_tag)")
      .eq("id", rawData.id)
      .eq("account_id", ctx.accountId)
      .single();

    if (fetchError || !finalData) {
      console.error("[POST /api/properties] Fetch final error:", fetchError);
      return NextResponse.json(
        { error: "Failed to retrieve created property" },
        { status: 500 }
      );
    }

    autoSyncPropertyCatalogIfNeeded(ctx.supabase, finalData.id, ctx.accountId).catch((err) => {
      console.error("[POST /api/properties] Auto-sync background error:", err);
    });

    // Match Radar: surface matching buyers for the new listing
    // (fire-and-forget; match_events INSERT needs the service role).
    import("@/lib/radar/engine")
      .then(({ generateMatchEventForProperty, radarAdminClient }) =>
        generateMatchEventForProperty(radarAdminClient(), ctx.accountId, finalData.id)
      )
      .catch((err) => {
        console.error("[POST /api/properties] Radar background error:", err);
      });

    return NextResponse.json(finalData, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
