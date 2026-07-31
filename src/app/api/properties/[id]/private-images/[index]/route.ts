import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canViewExactLocation } from "@/lib/inventory/location-guard";
import { storageObjectPath } from "@/lib/storage/url";

const PRIVATE_BUCKET = "property-images-private";

// GET /api/properties/[id]/private-images/[index]
// Streams one private photo to a viewer who may see through the guard
// (admin+ or the listing agent). The bucket has no public read policy,
// so this route is the only authenticated path to these objects.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  try {
    const ctx = await requireRole("viewer");
    const { id, index } = await params;
    const i = Number.parseInt(index, 10);

    if (!id || !Number.isInteger(i) || i < 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: property, error } = await ctx.supabase
      .from("properties")
      .select("id, user_id, type, location_privacy, private_images")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET private-images/[index]] Select error:", error);
      return NextResponse.json({ error: "Failed to fetch property" }, { status: 500 });
    }
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (
      !canViewExactLocation(
        { role: ctx.role, userId: ctx.userId },
        property as { type: string; user_id: string | null; location_privacy?: string | null }
      )
    ) {
      return NextResponse.json({ error: "Restricted" }, { status: 403 });
    }

    const list: string[] = Array.isArray(property.private_images)
      ? property.private_images
      : [];
    const objectPath = storageObjectPath(list[i]);
    if (!objectPath || !objectPath.startsWith(`${PRIVATE_BUCKET}/`)) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const key = objectPath.slice(PRIVATE_BUCKET.length + 1);
    const { data: file, error: downloadError } = await supabaseAdmin()
      .storage.from(PRIVATE_BUCKET)
      .download(key);
    if (downloadError || !file) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": file.type || "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
