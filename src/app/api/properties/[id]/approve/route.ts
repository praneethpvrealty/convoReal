import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { autoSyncPropertyCatalogIfNeeded } from "@/lib/whatsapp/catalog-sync-helper";
import { sendWhatsAppMessageAndPersist } from "@/lib/whatsapp/meta-api-dispatcher";

// POST /api/properties/[id]/approve
//
// Dedicated approval endpoint for "Pending Review" listings.
// Separated from the generic PUT so approval side-effects (WA
// notification, state-machine guard) don't bleed into every update.
//
// Steps:
//   1. Load the property (with owner contact join) to verify state
//   2. Guard: property must currently be "Pending Review"
//   3. Update status → "Available", is_published → true
//   4. Trigger background Meta catalog sync (same as PUT)
//   5. If owner_contact_id exists, send a WhatsApp approval notice
//      via sendWhatsAppMessageAndPersist (handles conversation
//      creation, message persistence, 24h-window logic, etc.)
//   6. Return { property, notificationSent } so the UI can show
//      the right toast message
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(
      `agent:approveProperty:${ctx.userId}`,
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

    // Load with owner join so we can send the notification in the same
    // request without a second round-trip.
    const { data: property, error: fetchError } = await ctx.supabase
      .from("properties")
      .select(
        "id, title, location, status, owner_contact_id, owner:contacts!properties_owner_contact_id_fkey(id, name, phone)"
      )
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (fetchError) {
      console.error("[POST /api/properties/[id]/approve] Fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to load property" },
        { status: 500 }
      );
    }

    if (!property) {
      return NextResponse.json(
        { error: "Property not found or access denied" },
        { status: 404 }
      );
    }

    if (property.status !== "Pending Review") {
      return NextResponse.json(
        { error: `Property is already "${property.status}" — can only approve "Pending Review" listings` },
        { status: 409 }
      );
    }

    // Approve: mark Available + publish
    const { data: updated, error: updateError } = await ctx.supabase
      .from("properties")
      .update({ status: "Available", is_published: true })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select(
        "*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification), interested_contacts:contacts!contacts_last_inquired_property_id_fkey(id, name, phone, classification)"
      )
      .single();

    if (updateError) {
      console.error("[POST /api/properties/[id]/approve] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to approve property" },
        { status: 500 }
      );
    }

    // Background: sync to Meta product catalog (fire-and-forget)
    autoSyncPropertyCatalogIfNeeded(ctx.supabase, id, ctx.accountId).catch(
      (err) => {
        console.error(
          "[POST /api/properties/[id]/approve] Catalog sync error:",
          err
        );
      }
    );

    // Match Radar: an approved listing just went live — surface matching
    // buyers (fire-and-forget).
    import("@/lib/radar/engine")
      .then(({ generateMatchEventForProperty, radarAdminClient }) =>
        generateMatchEventForProperty(radarAdminClient(), ctx.accountId, id)
      )
      .catch((err) => {
        console.error("[POST /api/properties/[id]/approve] Radar error:", err);
      });

    // Send WhatsApp notification to the tagged owner contact (if any).
    // senderType 'bot' so it shows in the conversation thread without
    // claiming an agent sent it manually.
    let notificationSent = false;
    let ownerName: string | null = null;

    const ownerData = property.owner;
    const owner = (Array.isArray(ownerData) ? ownerData[0] : ownerData) as unknown as { id: string; name: string | null; phone: string | null; } | null;

    if (owner?.id && owner?.phone) {
      ownerName = owner.name ?? owner.phone;
      const displayName = owner.name?.split(" ")[0] || "there";

      const messageText =
        `Hi ${displayName}! 🎉 Great news — your property *${property.title}* at ${property.location} has been reviewed and approved by our team.\n\n` +
        `It is now live and will be actively showcased to potential buyers. We'll keep you updated on any inquiries!`;

      try {
        const result = await sendWhatsAppMessageAndPersist({
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId: owner.id,
          kind: "text",
          senderType: "bot",
          text: messageText,
        });

        if (result.success) {
          notificationSent = true;
          console.log(
            `[POST /api/properties/[id]/approve] WA notification sent to contact ${owner.id} (${owner.phone})`
          );
        } else {
          // Non-fatal: property is already approved; log and continue.
          console.warn(
            `[POST /api/properties/[id]/approve] WA notification failed (non-fatal): ${result.error}`
          );
        }
      } catch (waErr) {
        console.error(
          "[POST /api/properties/[id]/approve] WA notification exception (non-fatal):",
          waErr
        );
      }
    }

    return NextResponse.json({
      property: updated,
      notificationSent,
      ownerName,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
