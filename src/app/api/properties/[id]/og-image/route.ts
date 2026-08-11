import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { renderFlyer } from "@/lib/inventory/flyer-render";
import { parseFlyerOptions } from "@/lib/inventory/flyer-options";
import { storagePublicUrl } from "@/lib/storage/url";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isLocationGuarded, localityLabel } from "@/lib/inventory/location-guard";
import { isTeaserGated } from "@/lib/inventory/showcase-visibility";
import { BRANDING } from "@/config/branding";

// GET /api/properties/[id]/og-image
// Public, crawlable link-preview image for a shared property showcase link.
// Renders a branded flyer from the listing (with the first photo as the
// backdrop when present) so a shared `?property_id=` link always previews a
// photo in WhatsApp/Telegram/X — including photoless land/plot listings,
// which otherwise had no preview image. The listing details it exposes are
// already public via the showcase page, so no auth is required; a per-IP
// rate limit bounds render cost against enumeration.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return new NextResponse("Not found", { status: 404 });

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = checkRateLimit(`ogImage:${ip}`, RATE_LIMITS.flyerRender);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const isUuid = UUID_RE.test(id);
    let query = admin
      .from("properties")
      .select(
        "id, title, property_code, type, price, location, location_privacy, showcase_visibility, sublocality, city, state, images, account_id"
      );
    query = isUuid ? query.eq("id", id) : query.eq("property_code", id.toUpperCase());
    const { data: raw } = await query.maybeSingle();
    if (!raw) return new NextResponse("Not found", { status: 404 });

    // A teaser-gated listing has no public preview at all: this PNG would
    // burn its title, price and cover photo into an image that messenger
    // crawlers fetch, cache and serve on every forward of the link.
    if (isTeaserGated(raw)) return new NextResponse("Not found", { status: 404 });

    // The rendered PNG is fetched and cached by messenger crawlers, so a
    // guarded listing's street address must never be burned into it.
    const property = isLocationGuarded(raw)
      ? { ...raw, location: localityLabel(raw) }
      : raw;

    const { data: settings } = await admin
      .from("showcase_settings")
      .select("currency")
      .eq("account_id", property.account_id)
      .maybeSingle();
    const currency = settings?.currency || "INR";

    const images = Array.isArray(property.images)
      ? property.images.filter(
          (u): u is string => typeof u === "string" && u.trim().length > 0
        )
      : [];
    const background = images[0] ? storagePublicUrl(images[0]) : null;

    const parsed = parseFlyerOptions({ size: 1080, brand_name: BRANDING.name });
    if ("error" in parsed) {
      return new NextResponse("Failed to build flyer options", { status: 500 });
    }

    const image = await renderFlyer({
      property,
      options: parsed.options,
      currency,
      background,
    });
    const png = Buffer.from(await image.arrayBuffer());

    return new NextResponse(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // The route lives under /api, which next.config forces to
        // `no-store`; messenger crawlers cache the preview on their side
        // after the first fetch, so a per-share render is acceptable.
        "Content-Length": String(png.length),
      },
    });
  } catch (err) {
    console.error("[GET /api/properties/[id]/og-image] Error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
