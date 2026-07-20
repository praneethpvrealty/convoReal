import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { parseFlyerOptions } from "@/lib/inventory/flyer-options";
import { renderFlyer } from "@/lib/inventory/flyer-render";

// POST /api/properties/[id]/flyer
// Renders a marketing flyer for a property server-side (next/og), so
// canvas-less clients (the mobile app) get the same flyer creator as
// the web dialog. Without `save` it returns a preview data URL; with
// `save: true` it uploads the 1080x1080 PNG to storage and prepends it
// to the property's images, mirroring the web "Save to Property Photos".
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(
      `agent:renderFlyer:${ctx.userId}`,
      RATE_LIMITS.flyerRender
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Property ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = parseFlyerOptions(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { options } = parsed;

    const { data: property, error } = await ctx.supabase
      .from("properties")
      .select("id, title, property_code, type, price, location, images")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[POST /api/properties/[id]/flyer] Select error:", error);
      return NextResponse.json(
        { error: "Failed to fetch property" },
        { status: 500 }
      );
    }
    if (!property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    const { data: settings } = await ctx.supabase
      .from("showcase_settings")
      .select("currency")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    const currency = settings?.currency || "INR";

    const currentImages = Array.isArray(property.images)
      ? property.images.filter((u): u is string => typeof u === "string")
      : [];
    const background =
      options.imageSource === "ai" ? options.aiImage : currentImages[0] ?? null;

    let png: Buffer;
    try {
      const image = await renderFlyer({ property, options, currency, background });
      png = Buffer.from(await image.arrayBuffer());
    } catch (renderErr) {
      console.error("[POST /api/properties/[id]/flyer] Render error:", renderErr);
      return NextResponse.json(
        { error: "Failed to render flyer" },
        { status: 500 }
      );
    }

    if (!options.save) {
      return NextResponse.json({
        data: { image: `data:image/png;base64,${png.toString("base64")}` },
      });
    }

    const randomStr = Math.random().toString(36).substring(2, 7);
    const path = `${ctx.accountId}/flyer-${Date.now()}-${randomStr}.png`;

    const { error: uploadError } = await ctx.supabase.storage
      .from("property-images")
      .upload(path, png, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/png",
      });

    if (uploadError) {
      console.error("[POST /api/properties/[id]/flyer] Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload flyer" },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = ctx.supabase.storage.from("property-images").getPublicUrl(path);

    const updatedImages = [publicUrl, ...currentImages.filter((u) => u !== publicUrl)];

    const { error: updateError } = await ctx.supabase
      .from("properties")
      .update({ images: updatedImages, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (updateError) {
      console.error("[POST /api/properties/[id]/flyer] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to save flyer to property" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { url: publicUrl, images: updatedImages } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
