import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { storagePublicUrl } from "@/lib/storage/url";
import type { Property } from "@/types";

/**
 * GET /api/public/properties/similar
 *
 * Smart similar-property matching for the showcase detail modal.
 * Instead of just matching by type, this endpoint uses a multi-signal
 * scoring approach to surface the most relevant recommendations:
 *
 *   1. Same sublocality / location area   → +30 pts
 *   2. Same city                          → +10 pts
 *   3. Same listing type (Sale / Rent)    → +20 pts
 *   4. Same property type                 → +15 pts
 *   5. Price within ±30% band             → +20 pts
 *   6. Bedrooms within ±1 range           → +10 pts
 *   7. Geo-proximity (< 5 km)            → +5 pts  (bonus)
 *
 * Fetches a broader candidate set from the DB (same account, published,
 * available) and scores + ranks client-side for maximum flexibility.
 */

const CANDIDATE_LIMIT = 40; // broad fetch, then score locally
const RESULT_LIMIT = 4;

// Haversine distance in km (for geo-proximity bonus)
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PUBLIC_PROPERTY_COLUMNS = [
  "id", "account_id", "user_id", "title", "description", "price",
  "location", "sublocality", "city", "state", "type", "status",
  "listing_type", "bedrooms", "bathrooms", "area_sqft", "area_unit",
  "land_area", "land_area_unit", "super_built_area", "project",
  "land_zone", "ideal_for", "dimensions", "road_width", "road_width_unit",
  "facing_direction", "nearby_highlights", "is_published", "features",
  "images", "google_map_link", "property_code", "owner_contact_id",
  "rental_income", "roi", "listing_source", "rent_per_month",
  "maintenance", "advance", "gst", "jv_structure", "owner_share_percent",
  "builder_share_percent", "goodwill_amount", "bts_lease_years",
  "bts_lock_in_years", "bts_escalation_percent", "latitude", "longitude",
  "created_at", "updated_at",
].join(", ");

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id");
    const propertyId = searchParams.get("property_id");

    if (!accountId || !propertyId) {
      return NextResponse.json(
        { error: "Missing required 'account_id' and 'property_id' query parameters" },
        { status: 400 }
      );
    }

    // Seed property attributes (passed as query params to avoid a second DB call)
    const seedType = searchParams.get("type") || "";
    const seedListingType = searchParams.get("listing_type") || "";
    const seedPrice = parseFloat(searchParams.get("price") || "0") || 0;
    const seedRent = parseFloat(searchParams.get("rent") || "0") || 0;
    const seedBedrooms = parseInt(searchParams.get("bedrooms") || "0", 10) || 0;
    const seedLocation = (searchParams.get("location") || "").toLowerCase();
    const seedSublocality = (searchParams.get("sublocality") || "").toLowerCase();
    const seedCity = (searchParams.get("city") || "").toLowerCase();
    const seedLat = parseFloat(searchParams.get("lat") || "0") || 0;
    const seedLon = parseFloat(searchParams.get("lon") || "0") || 0;

    // Effective price for comparison (rent / built-to-suit use rent_per_month)
    const seedEffectivePrice =
      seedListingType === "Rent" || seedListingType === "Built to Suit" ? seedRent : seedPrice;

    const client = supabaseAdmin();

    // Fetch a broad candidate pool — same account, published, available, excluding current property
    const { data: rawCandidates, error } = await client
      .from("properties")
      .select(PUBLIC_PROPERTY_COLUMNS)
      .eq("account_id", accountId)
      .eq("is_published", true)
      .eq("status", "Available")
      .neq("id", propertyId)
      .order("created_at", { ascending: false })
      .limit(CANDIDATE_LIMIT);

    const candidates = (rawCandidates ?? []) as unknown as Property[];

    if (error) {
      console.error("[GET /api/public/properties/similar] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch similar properties" },
        { status: 500 }
      );
    }

    if (candidates.length === 0) {
      return NextResponse.json({ data: [] }, {
        headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" },
      });
    }

    // Score each candidate
    interface ScoredCandidate {
      property: Property;
      score: number;
      matchReasons: string[];
    }

    const scored: ScoredCandidate[] = candidates.map((p) => {
      let score = 0;
      const reasons: string[] = [];

      // 1. Location match — sublocality is the strongest signal
      const pSublocality = (p.sublocality || "").toLowerCase();
      const pLocation = (p.location || "").toLowerCase();
      const pCity = (p.city || "").toLowerCase();

      if (seedSublocality && pSublocality && pSublocality === seedSublocality) {
        score += 30;
        reasons.push("same_area");
      } else if (seedLocation && pLocation && (
        pLocation.includes(seedLocation) || seedLocation.includes(pLocation)
      )) {
        score += 25;
        reasons.push("similar_location");
      }

      if (seedCity && pCity && pCity === seedCity) {
        score += 10;
        reasons.push("same_city");
      }

      // 2. Listing type match (Sale vs Rent)
      if (seedListingType && p.listing_type === seedListingType) {
        score += 20;
        reasons.push("same_listing_type");
      }

      // 3. Property type match
      if (seedType && p.type === seedType) {
        score += 15;
        reasons.push("same_type");
      }

      // 4. Price band (±30%)
      if (seedEffectivePrice > 0) {
        const pEffectivePrice = p.listing_type === "Rent" || p.listing_type === "Built to Suit"
          ? (p.rent_per_month || 0)
          : (p.price || 0);

        if (pEffectivePrice > 0) {
          const ratio = pEffectivePrice / seedEffectivePrice;
          if (ratio >= 0.7 && ratio <= 1.3) {
            score += 20;
            reasons.push("similar_price");
          } else if (ratio >= 0.5 && ratio <= 1.5) {
            score += 10;
            reasons.push("near_price");
          }
        }
      }

      // 5. Bedrooms proximity (±1)
      if (seedBedrooms > 0 && p.bedrooms && p.bedrooms > 0) {
        const diff = Math.abs(p.bedrooms - seedBedrooms);
        if (diff === 0) {
          score += 10;
          reasons.push("exact_bedrooms");
        } else if (diff === 1) {
          score += 5;
          reasons.push("near_bedrooms");
        }
      }

      // 6. Geo-proximity bonus (when both have coordinates)
      if (seedLat && seedLon && p.latitude && p.longitude) {
        const dist = haversineKm(seedLat, seedLon, p.latitude, p.longitude);
        if (dist < 2) {
          score += 5;
          reasons.push("very_close");
        } else if (dist < 5) {
          score += 3;
          reasons.push("nearby");
        }
      }

      return { property: p, score, matchReasons: reasons };
    });

    // Sort by score descending, then by recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.property.created_at).getTime() - new Date(a.property.created_at).getTime();
    });

    // Return top N that have at least some relevance (score > 0)
    // If fewer than RESULT_LIMIT have score > 0, backfill with remaining by recency
    const relevant = scored.filter((s) => s.score > 0).slice(0, RESULT_LIMIT);
    if (relevant.length < RESULT_LIMIT) {
      const filler = scored
        .filter((s) => s.score === 0)
        .slice(0, RESULT_LIMIT - relevant.length);
      relevant.push(...filler);
    }

    return NextResponse.json({
      data: relevant.map((s) => ({
        ...s.property,
        images: Array.isArray(s.property.images)
          ? s.property.images.map(storagePublicUrl)
          : s.property.images,
        _similarity_score: s.score,
        _match_reasons: s.matchReasons,
      })),
    }, {
      headers: {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[GET /api/public/properties/similar] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
