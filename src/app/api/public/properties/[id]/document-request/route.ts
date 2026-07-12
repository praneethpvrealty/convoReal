import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { normalizePhoneWithCountryCode } from "@/lib/whatsapp/phone-utils";
import { sendWhatsAppMessageAndPersist } from "@/lib/whatsapp/meta-api-dispatcher";

// POST /api/public/properties/[id]/document-request
// Lets any visitor request access to the documents for a property.
// Creates a property_document_requests row, routes an inbox message
// to the agent, and sends a WhatsApp notification to the agent.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: propertyId } = await params;
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { requester_name, requester_phone, requester_email, account_id } = body;

    if (!requester_name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!requester_phone?.trim()) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }
    if (!account_id) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const normalizedPhone = normalizePhoneWithCountryCode(requester_phone.trim());
    if (!normalizedPhone) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // 1. Verify property exists and belongs to the account
    const { data: property, error: propErr } = await admin
      .from("properties")
      .select("id, title, property_code, user_id, is_published")
      .eq("id", propertyId)
      .eq("account_id", account_id)
      .maybeSingle();

    if (propErr || !property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    // 2. Rate-limit: max 3 pending requests per phone per property
    const { count: existingCount } = await admin
      .from("property_document_requests")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("requester_phone", normalizedPhone)
      .eq("status", "pending");

    if ((existingCount ?? 0) >= 3) {
      return NextResponse.json(
        { error: "You have already submitted a document request for this property. Please wait for the agent to respond." },
        { status: 429 }
      );
    }

    // 3. Insert the document request row
    const { data: docRequest, error: insertErr } = await admin
      .from("property_document_requests")
      .insert({
        property_id: propertyId,
        account_id,
        requester_name: requester_name.trim(),
        requester_phone: normalizedPhone,
        requester_email: requester_email?.trim()?.toLowerCase() || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr || !docRequest) {
      console.error("[POST /api/public/properties/[id]/document-request] Insert error:", insertErr);
      return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
    }

    // 4. Resolve the managing agent
    const { data: account } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", account_id)
      .maybeSingle();

    let targetAgentUserId = account?.owner_user_id || null;

    if (property.user_id) {
      targetAgentUserId = property.user_id;
    }

    // 5. Find or create a contact for the requester so we can thread inbox messages
    let contactId: string | null = null;
    try {
      const { data: existingContacts } = await admin
        .from("contacts")
        .select("id")
        .eq("account_id", account_id)
        .eq("phone", normalizedPhone);

      const existingContact = existingContacts && existingContacts.length > 0 ? existingContacts[0] : null;

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact } = await admin
          .from("contacts")
          .insert({
            account_id,
            user_id: targetAgentUserId,
            phone: normalizedPhone,
            name: requester_name.trim(),
            email: requester_email?.trim()?.toLowerCase() || null,
            classification: "Buyer",
            status: "pending_review",
            referrer: "Document Request",
          })
          .select("id")
          .single();
        contactId = newContact?.id || null;
      }
    } catch (err) {
      console.error("[doc-request] Contact upsert failed:", err);
    }

    // 6. Route a message to the CRM inbox so the agent sees the request
    if (contactId) {
      try {
        const { data: existingConv } = await admin
          .from("conversations")
          .select("id, unread_count")
          .eq("account_id", account_id)
          .eq("contact_id", contactId)
          .maybeSingle();

        let conversationId: string | undefined;
        let currentUnread = 0;

        if (existingConv) {
          conversationId = existingConv.id;
          currentUnread = existingConv.unread_count || 0;
        } else {
          const { data: newConv } = await admin
            .from("conversations")
            .insert({ account_id, user_id: targetAgentUserId, contact_id: contactId, unread_count: 0 })
            .select("id")
            .single();
          conversationId = newConv?.id;
        }

        if (conversationId) {
          const inboxText =
            `📄 *Document Access Request*\n\n` +
            `🏡 *Property*: ${property.title}${property.property_code ? ` (${property.property_code})` : ""}\n` +
            `👤 *Name*: ${requester_name.trim()}\n` +
            `📞 *Phone*: ${normalizedPhone}` +
            (requester_email ? `\n📧 *Email*: ${requester_email.trim()}` : "") +
            `\n\n_Reply via the CRM dashboard to Approve or Reject this request._`;

          await admin.from("messages").insert({
            conversation_id: conversationId,
            sender_type: "customer",
            content_type: "text",
            content_text: inboxText,
            message_id: `doc-request-${docRequest.id}`,
            status: "delivered",
            created_at: new Date().toISOString(),
          });

          await admin
            .from("conversations")
            .update({
              last_message_text: inboxText,
              last_message_at: new Date().toISOString(),
              unread_count: currentUnread + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", conversationId);
        }
      } catch (err) {
        console.error("[doc-request] Inbox routing failed:", err);
      }
    }

    // 7. Send WhatsApp notification to the agent (fire-and-forget)
    if (targetAgentUserId) {
      (async () => {
        try {
          // Resolve the agent's phone via their profile → contact
          const { data: agentProfile } = await admin
            .from("profiles")
            .select("email")
            .eq("user_id", targetAgentUserId!)
            .maybeSingle();

          if (agentProfile?.email) {
            const { data: agentContact } = await admin
              .from("contacts")
              .select("id, phone")
              .eq("account_id", account_id)
              .eq("email", agentProfile.email)
              .maybeSingle();

            if (agentContact?.phone) {
              const notifText =
                `📄 *New Document Request*\n` +
                `Property: ${property.title}${property.property_code ? ` (${property.property_code})` : ""}\n` +
                `From: ${requester_name.trim()} · ${normalizedPhone}\n\n` +
                `Open your CRM dashboard to Approve or Reject this request.`;

              await sendWhatsAppMessageAndPersist({
                accountId: account_id,
                userId: targetAgentUserId || undefined,
                contactId: agentContact.id,
                kind: "text",
                senderType: "bot",
                text: notifText,
              });
            }
          }
        } catch (err) {
          console.error("[doc-request] Agent WA notification failed:", err);
        }
      })();
    }

    return NextResponse.json({ success: true, requestId: docRequest.id });
  } catch (err) {
    console.error("[POST /api/public/properties/[id]/document-request] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
