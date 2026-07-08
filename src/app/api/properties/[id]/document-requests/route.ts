import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sendWhatsAppMessageAndPersist } from "@/lib/whatsapp/meta-api-dispatcher";
import { normalizePhoneWithCountryCode } from "@/lib/whatsapp/phone-utils";

// GET /api/properties/[id]/document-requests
// List all document requests for a given property (auth required)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("viewer");
    const { id: propertyId } = await params;

    // Verify property belongs to this account
    const { data: property } = await ctx.supabase
      .from("properties")
      .select("id, title, property_code")
      .eq("id", propertyId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from("property_document_requests")
      .select("*")
      .eq("property_id", propertyId)
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/properties/[id]/document-requests]", error);
      return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/properties/[id]/document-requests
// Approve or reject a document request. On approval, generate a share token
// and automatically send it to the requester via WhatsApp.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");
    const { id: propertyId } = await params;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { request_id, action, access_password } = body; // action: 'approve' | 'reject'

    if (!request_id || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "request_id and action ('approve'|'reject') are required" }, { status: 400 });
    }

    // Fetch the specific document request
    const { data: docRequest, error: fetchErr } = await ctx.supabase
      .from("property_document_requests")
      .select("*")
      .eq("id", request_id)
      .eq("property_id", propertyId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (fetchErr || !docRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (docRequest.status !== "pending") {
      return NextResponse.json({ error: "This request has already been processed" }, { status: 409 });
    }

    if (action === "reject") {
      const { data: updated, error: updateErr } = await ctx.supabase
        .from("property_document_requests")
        .update({ status: "rejected" })
        .eq("id", request_id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
      }

      return NextResponse.json({ data: updated });
    }

    // === Approval flow ===

    // 1. Fetch property documents
    const admin = supabaseAdmin();
    const { data: property } = await admin
      .from("properties")
      .select("id, title, property_code, documents")
      .eq("id", propertyId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    // 2. Generate a cryptographically secure share token
    const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const shareToken = rawToken.substring(0, 48);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h

    // 3. Build the shareable link
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.convoreal.com";
    const shareLink = `${appBaseUrl}/docs/${shareToken}`;

    // 4. Update the document request row
    const { data: updated, error: updateErr } = await ctx.supabase
      .from("property_document_requests")
      .update({
        status: "approved",
        share_token: shareToken,
        share_token_expires_at: expiresAt,
        access_password: access_password || null,
      })
      .eq("id", request_id)
      .select()
      .single();

    if (updateErr) {
      console.error("[PATCH doc-request] Update error:", updateErr);
      return NextResponse.json({ error: "Failed to approve request" }, { status: 500 });
    }

    // 5. Send WhatsApp message to requester (fire-and-forget)
    (async () => {
      try {
        const normalizedPhone = normalizePhoneWithCountryCode(docRequest.requester_phone, "91");
        if (!normalizedPhone) return;

        const hasDocuments =
          Array.isArray(property.documents) &&
          property.documents.filter((d: string) => d?.trim()).length > 0;

        const waText = hasDocuments
          ? (access_password
              ? `Hi ${docRequest.requester_name},\n\nHere is the link for the documents of the property *${property.title}* asked. Please use the password - *${access_password}* to open it.\n\n📂 *Download Link*: ${shareLink}\n\n_This link will expire in 48 hours._`
              : `Hi ${docRequest.requester_name},\n\nYour request for property documents has been approved! 🎉\n\n` +
                `📋 *Property*: ${property.title}${property.property_code ? ` (${property.property_code})` : ""}\n` +
                `📂 *Download Documents*: ${shareLink}\n\n` +
                `_This link will expire in 48 hours._`)
          : `Hi ${docRequest.requester_name},\n\nThank you for your interest in ${property.title}.\n\n` +
            `The documents for this property are being prepared. Our agent will share them with you shortly.\n\n` +
            `Feel free to reach out for any queries.`;

        await sendWhatsAppMessageAndPersist({
          accountId: ctx.accountId,
          userId: ctx.userId,
          toPhone: normalizedPhone,
          kind: "text",
          senderType: "agent",
          text: waText,
        });

        // Mark share_sent_at
        await admin
          .from("property_document_requests")
          .update({ share_sent_at: new Date().toISOString() })
          .eq("id", request_id);
      } catch (err) {
        console.error("[PATCH doc-request] WA send to requester failed:", err);
      }
    })();

    return NextResponse.json({
      data: updated,
      share_link: shareLink,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/properties/[id]/document-requests
// Create a new approved document request directly (agent/admin only).
// On insertion, generate a share token and automatically send it to the requester via WhatsApp.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("agent");
    const { id: propertyId } = await params;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { requester_name, requester_phone, requester_email, access_password } = body;

    if (!requester_name || !requester_phone) {
      return NextResponse.json({ error: "requester_name and requester_phone are required" }, { status: 400 });
    }

    // 1. Fetch property to check ownership/existence
    const admin = supabaseAdmin();
    const { data: property } = await admin
      .from("properties")
      .select("id, title, property_code, documents")
      .eq("id", propertyId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    // 2. Generate a cryptographically secure share token
    const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const shareToken = rawToken.substring(0, 48);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h

    // 3. Insert approved document request
    const { data: docRequest, error: insertErr } = await admin
      .from("property_document_requests")
      .insert({
        property_id: propertyId,
        account_id: ctx.accountId,
        requester_name,
        requester_phone,
        requester_email: requester_email || null,
        status: "approved",
        share_token: shareToken,
        share_token_expires_at: expiresAt,
        access_password: access_password || null,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[POST doc-request] Insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
    }

    // 4. Build the shareable link
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.convoreal.com";
    const shareLink = `${appBaseUrl}/docs/${shareToken}`;

    // 5. Send WhatsApp message (fire-and-forget)
    (async () => {
      try {
        const normalizedPhone = normalizePhoneWithCountryCode(requester_phone, "91");
        if (!normalizedPhone) return;

        const hasDocuments =
          Array.isArray(property.documents) &&
          property.documents.filter((d: string) => d?.trim()).length > 0;

        const waText = hasDocuments
          ? (access_password
              ? `Hi ${requester_name},\n\nHere is the link for the documents of the property *${property.title}* asked. Please use the password - *${access_password}* to open it.\n\n📂 *Download Link*: ${shareLink}\n\n_This link will expire in 48 hours._`
              : `Hi ${requester_name},\n\nHere are the property documents you requested! 🎉\n\n` +
                `📋 *Property*: ${property.title}${property.property_code ? ` (${property.property_code})` : ""}\n` +
                `📂 *Download Documents*: ${shareLink}\n\n` +
                `_This link will expire in 48 hours._`)
          : `Hi ${requester_name},\n\nThank you for your interest in ${property.title}.\n\n` +
            `The documents for this property are being prepared. Our agent will share them with you shortly.\n\n` +
            `Feel free to reach out for any queries.`;

        await sendWhatsAppMessageAndPersist({
          accountId: ctx.accountId,
          userId: ctx.userId,
          toPhone: normalizedPhone,
          kind: "text",
          senderType: "agent",
          text: waText,
        });

        // Mark share_sent_at
        await admin
          .from("property_document_requests")
          .update({ share_sent_at: new Date().toISOString() })
          .eq("id", docRequest.id);
      } catch (err) {
        console.error("[POST doc-request] WA send to requester failed:", err);
      }
    })();

    return NextResponse.json({
      success: true,
      share_link: shareLink,
      data: docRequest,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
