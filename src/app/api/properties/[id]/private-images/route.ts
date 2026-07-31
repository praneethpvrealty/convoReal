import { NextResponse } from "next/server";
import { requireRole, toErrorResponse, ForbiddenError } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canViewExactLocation } from "@/lib/inventory/location-guard";
import { storageObjectPath } from "@/lib/storage/url";

const PUBLIC_BUCKET = "property-images";
const PRIVATE_BUCKET = "property-images-private";

// POST /api/properties/[id]/private-images
// Locks a photo (moves it from the public bucket into the non-public
// one) or unlocks it (moves it back). The object key is preserved so
// hero-index semantics and cleanup stay simple; the old public URL 404s
// the moment the move completes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(
      `agent:privateImages:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      path?: string;
      action?: string;
    } | null;
    const action = body?.action;
    const rawPath = typeof body?.path === "string" ? body.path : "";
    const objectPath = storageObjectPath(rawPath);

    if (!id || !objectPath || (action !== "lock" && action !== "unlock")) {
      return NextResponse.json(
        { error: "'path' and 'action' ('lock' | 'unlock') are required" },
        { status: 400 }
      );
    }

    const { data: property, error } = await ctx.supabase
      .from("properties")
      .select("id, user_id, type, location_privacy, images, private_images")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[POST private-images] Select error:", error);
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
      throw new ForbiddenError("Only admins or the listing agent can manage private photos");
    }

    const sourceBucket = action === "lock" ? PUBLIC_BUCKET : PRIVATE_BUCKET;
    const targetBucket = action === "lock" ? PRIVATE_BUCKET : PUBLIC_BUCKET;
    if (!objectPath.startsWith(`${sourceBucket}/`)) {
      return NextResponse.json(
        { error: `'path' must reference an object in ${sourceBucket}` },
        { status: 400 }
      );
    }
    const key = objectPath.slice(sourceBucket.length + 1);
    if (!key.startsWith(`${ctx.accountId}/`)) {
      return NextResponse.json({ error: "Path outside your account" }, { status: 403 });
    }

    const sourceList: string[] = Array.isArray(
      action === "lock" ? property.images : property.private_images
    )
      ? action === "lock"
        ? property.images
        : property.private_images
      : [];
    const entryIndex = sourceList.findIndex((v) => storageObjectPath(v) === objectPath);
    if (entryIndex === -1) {
      return NextResponse.json(
        { error: "Photo is not part of this property" },
        { status: 404 }
      );
    }

    const admin = supabaseAdmin();
    const { data: file, error: downloadError } = await admin.storage
      .from(sourceBucket)
      .download(key);
    if (downloadError || !file) {
      console.error("[POST private-images] Download error:", downloadError);
      return NextResponse.json({ error: "Failed to read photo" }, { status: 500 });
    }

    const { error: uploadError } = await admin.storage
      .from(targetBucket)
      .upload(key, file, { upsert: true, contentType: file.type || undefined });
    if (uploadError) {
      console.error("[POST private-images] Upload error:", uploadError);
      return NextResponse.json({ error: "Failed to move photo" }, { status: 500 });
    }

    const targetPath = `${targetBucket}/${key}`;
    const nextImages = Array.isArray(property.images) ? [...property.images] : [];
    const nextPrivate = Array.isArray(property.private_images)
      ? [...property.private_images]
      : [];
    if (action === "lock") {
      nextImages.splice(
        nextImages.findIndex((v: string) => storageObjectPath(v) === objectPath),
        1
      );
      if (!nextPrivate.some((v: string) => storageObjectPath(v) === targetPath)) {
        nextPrivate.push(targetPath);
      }
    } else {
      nextPrivate.splice(
        nextPrivate.findIndex((v: string) => storageObjectPath(v) === objectPath),
        1
      );
      if (!nextImages.some((v: string) => storageObjectPath(v) === targetPath)) {
        nextImages.push(targetPath);
      }
    }

    const { error: updateError } = await ctx.supabase
      .from("properties")
      .update({
        images: nextImages,
        private_images: nextPrivate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (updateError) {
      console.error("[POST private-images] Update error:", updateError);
      // Roll the object back so storage and the row stay consistent.
      await admin.storage.from(sourceBucket).upload(key, file, { upsert: true });
      await admin.storage.from(targetBucket).remove([key]);
      return NextResponse.json({ error: "Failed to update property" }, { status: 500 });
    }

    // Remove the source object last — if this fails the worst case is a
    // duplicate file, never a broken reference.
    const { error: removeError } = await admin.storage.from(sourceBucket).remove([key]);
    if (removeError) {
      console.warn("[POST private-images] Source remove failed:", removeError);
    }

    return NextResponse.json({
      data: { images: nextImages, private_images: nextPrivate },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
