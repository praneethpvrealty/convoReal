import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { storageObjectPath } from "@/lib/storage/url";

const PRIVATE_BUCKET = "property-images-private";
const REVEAL_IMAGE_LIMIT = { limit: 60, windowMs: 60_000 };

// GET /api/public/reveal/[token]/image/[index]
// Streams one private photo to the holder of an approved, unexpired
// location-reveal token. The token is validated on every request — the
// bucket itself has no public read policy.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; index: string }> }
) {
  try {
    const { token, index } = await params;
    const i = Number.parseInt(index, 10);
    if (!token || token.length < 20 || !Number.isInteger(i) || i < 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = checkRateLimit(`revealImage:${ip}`, REVEAL_IMAGE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data: locRequest } = await admin
      .from("property_location_requests")
      .select("id, status, share_token_expires_at, property:properties(private_images)")
      .eq("share_token", token)
      .maybeSingle();

    if (!locRequest || locRequest.status !== "approved") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      locRequest.share_token_expires_at &&
      new Date() > new Date(locRequest.share_token_expires_at)
    ) {
      return NextResponse.json({ error: "Link expired" }, { status: 410 });
    }

    const property = (
      Array.isArray(locRequest.property) ? locRequest.property[0] : locRequest.property
    ) as { private_images?: string[] } | null;
    const list = Array.isArray(property?.private_images) ? property.private_images : [];
    const objectPath = storageObjectPath(list[i]);
    if (!objectPath || !objectPath.startsWith(`${PRIVATE_BUCKET}/`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const key = objectPath.slice(PRIVATE_BUCKET.length + 1);
    const { data: file, error: downloadError } = await admin.storage
      .from(PRIVATE_BUCKET)
      .download(key);
    if (downloadError || !file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": file.type || "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[GET public/reveal image] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
