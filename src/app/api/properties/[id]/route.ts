import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { autoSyncPropertyCatalogIfNeeded } from "@/lib/whatsapp/catalog-sync-helper";
import { geocodeAddress, hasGoogleMapsKey } from "@/lib/maps/google-places";

// GET /api/properties/[id]
// Returns a single property with full relations (owner + interested_contacts)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("viewer");
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Property ID is required" },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from("properties")
      .select("*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/properties/[id]] Select error:", error);
      return NextResponse.json(
        { error: "Failed to fetch property" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/properties/[id]
// Updates an existing property listing
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");

    // Rate limiting to prevent abuse
    const limit = checkRateLimit(
      `agent:updateProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
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
      documents,
      // locality coordinates (from the form's Places autocomplete pick)
      latitude,
      longitude,
      locality_place_id,
      locality_canonical,
      interested_contact_ids,
    } = body;

    // Validate only if passed
    const updateData: Record<string, unknown> = {};

    if (latitude !== undefined) {
      updateData.latitude =
        typeof latitude === "number" && Number.isFinite(latitude) ? latitude : null;
    }
    if (longitude !== undefined) {
      updateData.longitude =
        typeof longitude === "number" && Number.isFinite(longitude) ? longitude : null;
    }
    if (locality_place_id !== undefined) {
      updateData.locality_place_id =
        typeof locality_place_id === "string" ? locality_place_id.trim() || null : null;
    }
    if (locality_canonical !== undefined) {
      updateData.locality_canonical =
        typeof locality_canonical === "string" ? locality_canonical.trim() || null : null;
    }

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        return NextResponse.json(
          { error: "'title' cannot be empty" },
          { status: 400 }
        );
      }
      updateData.title = title.trim();
    }

    if (price !== undefined) {
      if (typeof price !== "number" || price < 0) {
        return NextResponse.json(
          { error: "'price' must be a non-negative number" },
          { status: 400 }
        );
      }
      updateData.price = price;
    }

    if (location !== undefined) {
      if (typeof location !== "string" || location.trim().length === 0) {
        return NextResponse.json(
          { error: "'location' cannot be empty" },
          { status: 400 }
        );
      }
      updateData.location = location.trim();
    }

    if (type !== undefined) {
      if (typeof type !== "string" || type.trim().length === 0) {
        return NextResponse.json(
          { error: "'type' cannot be empty" },
          { status: 400 }
        );
      }
      updateData.type = type.trim();
    }

    if (status !== undefined) {
      if (typeof status !== "string" || status.trim().length === 0) {
        return NextResponse.json(
          { error: "'status' cannot be empty" },
          { status: 400 }
        );
      }
      updateData.status = status.trim();
    }

    if (description !== undefined) {
      updateData.description = typeof description === "string" ? description.trim() : null;
    }

    if (bedrooms !== undefined) {
      updateData.bedrooms = typeof bedrooms === "number" ? bedrooms : null;
    }

    if (bathrooms !== undefined) {
      updateData.bathrooms = typeof bathrooms === "number" ? bathrooms : null;
    }

    if (area_sqft !== undefined) {
      updateData.area_sqft = typeof area_sqft === "number" ? area_sqft : null;
    }

    if (area_unit !== undefined) {
      updateData.area_unit = typeof area_unit === "string" ? area_unit.trim() : "Sq.Ft.";
    }

    if (land_area !== undefined) {
      updateData.land_area = typeof land_area === "number" ? land_area : null;
    }

    if (land_area_unit !== undefined) {
      updateData.land_area_unit = typeof land_area_unit === "string" ? land_area_unit.trim() : "Sq.Ft.";
    }

    if (super_built_area !== undefined) {
      updateData.super_built_area = typeof super_built_area === "number" ? super_built_area : null;
    }

    if (sublocality !== undefined) {
      updateData.sublocality = typeof sublocality === "string" ? sublocality.trim() : null;
    }

    if (city !== undefined) {
      updateData.city = typeof city === "string" ? city.trim() : null;
    }

    if (state !== undefined) {
      updateData.state = typeof state === "string" ? state.trim() : null;
    }

    if (project !== undefined) {
      updateData.project = typeof project === "string" ? project.trim() : null;
    }

    if (is_published !== undefined) {
      updateData.is_published = typeof is_published === "boolean" ? is_published : false;
    }

    if (features !== undefined) {
      updateData.features = Array.isArray(features) ? features.filter(f => typeof f === "string") : [];
    }

    if (images !== undefined) {
      updateData.images = Array.isArray(images) ? images.filter(img => typeof img === "string") : [];
    }

    if (documents !== undefined) {
      updateData.documents = Array.isArray(documents) ? documents.filter(d => typeof d === "string") : [];
    }

    if (land_zone !== undefined) {
      updateData.land_zone = typeof land_zone === "string" ? land_zone.trim() : null;
    }

    if (ideal_for !== undefined) {
      updateData.ideal_for = typeof ideal_for === "string" ? ideal_for.trim() : null;
    }

    if (dimensions !== undefined) {
      updateData.dimensions = typeof dimensions === "string" ? dimensions.trim() : null;
    }

    if (road_width !== undefined) {
      updateData.road_width = typeof road_width === "number" ? road_width : null;
    }

    if (road_width_unit !== undefined) {
      updateData.road_width_unit = typeof road_width_unit === "string" ? road_width_unit.trim() : "Feet";
    }

    if (facing_direction !== undefined) {
      updateData.facing_direction = typeof facing_direction === "string" ? facing_direction.trim() : null;
    }

    if (nearby_highlights !== undefined) {
      updateData.nearby_highlights = Array.isArray(nearby_highlights) ? nearby_highlights.filter(h => typeof h === "string") : [];
    }

    if (owner_contact_id !== undefined) {
      updateData.owner_contact_id = typeof owner_contact_id === "string" && owner_contact_id.trim().length > 0 ? owner_contact_id.trim() : null;
    }

    if (google_map_link !== undefined) {
      updateData.google_map_link = typeof google_map_link === "string" ? google_map_link.trim() : null;
    }

    if (rental_income !== undefined) {
      updateData.rental_income = typeof rental_income === "number" ? rental_income : null;
    }

    if (roi !== undefined) {
      updateData.roi = typeof roi === "number" ? roi : null;
    }

    if (listing_source !== undefined) {
      updateData.listing_source = listing_source === "agent" ? "agent" : "owner";
    }

    if (listing_type !== undefined) {
      updateData.listing_type = listing_type === "Rent" ? "Rent" : "Sale";
    }

    if (rent_per_month !== undefined) {
      updateData.rent_per_month = typeof rent_per_month === "number" ? rent_per_month : null;
    }

    if (maintenance !== undefined) {
      updateData.maintenance = typeof maintenance === "number" ? maintenance : null;
    }

    if (advance !== undefined) {
      updateData.advance = typeof advance === "number" ? advance : null;
    }

    if (gst !== undefined) {
      updateData.gst = typeof gst === "number" ? gst : null;
    }

    if (notes !== undefined) {
      updateData.notes = typeof notes === "string" ? notes.trim() || null : null;
    }

    // Verify it exists in this account before updating (defensive check)
    const { data: existing, error: findError } = await ctx.supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (findError) {
      console.error("[PUT /api/properties/[id]] Find error:", findError);
      return NextResponse.json(
        { error: "Error checking property existence" },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Property not found or access denied" },
        { status: 404 }
      );
    }

    // Best-effort geocode when the location text changed but this update
    // carries no coordinates (typed edit, WhatsApp-intake correction, etc.)
    // so radius search keeps covering the property. Never blocks the save.
    if (
      typeof updateData.location === "string" &&
      latitude == null &&
      longitude == null &&
      hasGoogleMapsKey()
    ) {
      try {
        const geo = await geocodeAddress(
          [updateData.location, updateData.city, updateData.state]
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .join(", ")
        );
        if (geo) {
          updateData.latitude = geo.latitude;
          updateData.longitude = geo.longitude;
          if (updateData.locality_place_id === undefined) {
            updateData.locality_place_id = geo.place_id;
          }
        }
      } catch (geoErr) {
        console.warn("[PUT /api/properties/[id]] Geocode fallback failed:", geoErr);
      }
    }

    const { error: updateError } = await ctx.supabase
      .from("properties")
      .update(updateData)
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (updateError) {
      console.error("[PUT /api/properties/[id]] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update property" },
        { status: 500 }
      );
    }

    if (interested_contact_ids !== undefined) {
      const interestedContactIds = Array.isArray(interested_contact_ids) ? interested_contact_ids : [];

      // Clear contacts that were pointing to this property but are not in the new checked list
      const { data: previouslyLinked } = await ctx.supabase
        .from("contacts")
        .select("id")
        .eq("last_inquired_property_id", id);

      if (previouslyLinked) {
        const previouslyLinkedIds = previouslyLinked.map((c) => c.id);
        const toRemove = previouslyLinkedIds.filter((id) => !interestedContactIds.includes(id));

        if (toRemove.length > 0) {
          await ctx.supabase
            .from("contacts")
            .update({ last_inquired_property_id: null })
            .in("id", toRemove);
        }
      }

      // Link the new ones
      if (interestedContactIds.length > 0) {
        await ctx.supabase
          .from("contacts")
          .update({ last_inquired_property_id: id })
          .in("id", interestedContactIds);
      }
    }

    // Fetch the updated property with relations
    const { data: finalData, error: fetchErr } = await ctx.supabase
      .from("properties")
      .select("*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .single();

    if (fetchErr || !finalData) {
      console.error("[PUT /api/properties/[id]] Fetch final error:", fetchErr);
      return NextResponse.json(
        { error: "Failed to retrieve updated property" },
        { status: 500 }
      );
    }

    autoSyncPropertyCatalogIfNeeded(ctx.supabase, finalData.id, ctx.accountId).catch((err) => {
      console.error("[PUT /api/properties/[id]] Auto-sync background error:", err);
    });

    return NextResponse.json(finalData);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/properties/[id]
// Deletes a property listing
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");

    // Rate limiting to prevent abuse
    const limit = checkRateLimit(
      `agent:deleteProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Property ID is required" },
        { status: 400 }
      );
    }

    // Verify it exists in this account before deleting (defensive check)
    const { data: existing, error: findError } = await ctx.supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (findError) {
      console.error("[DELETE /api/properties/[id]] Find error:", findError);
      return NextResponse.json(
        { error: "Error checking property existence" },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Property not found or access denied" },
        { status: 404 }
      );
    }

    const { error } = await ctx.supabase
      .from("properties")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/properties/[id]] Delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete property" },
        { status: 500 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
