// ============================================================
// POST /api/den/properties/[id]/images — owner uploads listing photos.
//
// multipart/form-data with one or more `files` entries. Reuses the
// staff pipeline (uploadPropertyImage: Sharp compression →
// property-images bucket, foldered by the managing agency's account)
// and appends the URLs to the property's images array.
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { loadOwnedProperty } from "@/lib/den/properties";
import { uploadPropertyImage } from "@/lib/storage/upload";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_FILES_PER_REQUEST = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_PROPERTY = 30;

export const POST = withDenAuth(async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;

  const rate = checkRateLimit(`den-images:${ctx.denUserId}`, { limit: 30, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);

  const existing = await loadOwnedProperty(ctx, id);
  if (!existing) throw new UserFacingError("Property not found", 404);

  const form = await req.formData().catch(() => null);
  if (!form) throw new UserFacingError("Expected multipart/form-data");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new UserFacingError("No files provided");
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw new UserFacingError(`Upload at most ${MAX_FILES_PER_REQUEST} photos at a time`);
  }

  const currentImages: string[] = Array.isArray(existing.images)
    ? (existing.images as string[])
    : [];
  if (currentImages.length + files.length > MAX_IMAGES_PER_PROPERTY) {
    throw new UserFacingError(`A listing can have at most ${MAX_IMAGES_PER_PROPERTY} photos`);
  }

  const accountId = existing.account_id as string;
  const uploaded: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new UserFacingError(`${file.name || "File"} is not an image`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new UserFacingError(`${file.name || "File"} is larger than 15 MB`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadPropertyImage(accountId, buffer, file.type);
    uploaded.push(url);
  }

  const db = denAdmin();
  const { data, error } = await db
    .from("properties")
    .update({ images: [...currentImages, ...uploaded], updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, images")
    .single();
  if (error || !data) {
    console.error("[den images POST] update failed:", error);
    return NextResponse.json({ error: "Could not attach photos" }, { status: 500 });
  }

  return NextResponse.json({ property_id: id, images: data.images, added: uploaded });
});
