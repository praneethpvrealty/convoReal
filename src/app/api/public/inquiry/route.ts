import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { normalizePhoneWithCountryCode } from "@/lib/whatsapp/phone-utils";
import { findOrCreateContact } from "@/lib/contacts/find-or-create";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, message, propertyId, propertyTitle, propertyCode, accountId, referrerContactId } = body;

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required 'accountId' field" },
        { status: 400 }
      );
    }

    if (!phone) {
      return NextResponse.json(
        { error: "Missing required 'phone' field" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhoneWithCountryCode(phone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: "Invalid phone number format" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // 1. Fetch account owner_user_id to use as user_id for contact notes & default tasks
    const { data: account, error: accountError } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", accountId)
      .maybeSingle();

    if (accountError || !account) {
      console.error("[POST /api/public/inquiry] Account lookup failed:", accountError);
      return NextResponse.json(
        { error: "Invalid account ID" },
        { status: 400 }
      );
    }

    const systemUserId = account.owner_user_id;

    // Resolve the managing agent of the property if propertyId is provided
    let targetAgentUserId = systemUserId;
    let resolvedReferrerContactId = referrerContactId || null;

    if (propertyId) {
      const { data: propData } = await admin
        .from("properties")
        .select("user_id")
        .eq("id", propertyId)
        .maybeSingle();

      if (propData?.user_id) {
        targetAgentUserId = propData.user_id;

        // Try resolving the agent's contact ID using their profile email
        const { data: agentProfile } = await admin
          .from("profiles")
          .select("email")
          .eq("user_id", targetAgentUserId)
          .maybeSingle();

        if (agentProfile?.email) {
          const { data: agentContact } = await admin
            .from("contacts")
            .select("id")
            .eq("account_id", accountId)
            .eq("email", agentProfile.email)
            .maybeSingle();

          if (agentContact) {
            resolvedReferrerContactId = resolvedReferrerContactId || agentContact.id;
          }
        }
      }
    }

    // 2. Find or create contact with phone + email deduplication
    let contactId: string;
    try {
      const result = await findOrCreateContact(admin, {
        accountId,
        userId: targetAgentUserId,
        phone: normalizedPhone,
        name: name || "Website Lead",
        email: email || null,
        classification: "Buyer",
        referrer: "Website Showcase",
        referrerContactId: resolvedReferrerContactId,
        lastInquiredPropertyId: propertyId || null,
      });
      contactId = result.contactId;
    } catch (err) {
      console.error("[POST /api/public/inquiry] Contact find-or-create failed:", err);
      return NextResponse.json({ error: "Failed to process inquiry" }, { status: 500 });
    }

    // 3. Add inquiry details as a contact note
    let noteText = `Website Inquiry received:\n`;
    if (propertyTitle) {
      noteText += `• Interested in Property: ${propertyTitle}\n`;
    }
    if (propertyCode) {
      noteText += `• Property Code: ${propertyCode}\n`;
    }
    if (propertyId) {
      noteText += `• Property ID: ${propertyId}\n`;
    }
    if (message) {
      noteText += `• Message: ${message.trim()}\n`;
    } else {
      noteText += `• Message: (No message provided)\n`;
    }

    const { error: noteError } = await admin
      .from("contact_notes")
      .insert([
        {
          account_id: accountId,
          contact_id: contactId,
          user_id: targetAgentUserId,
          note_text: noteText,
        },
      ]);

    if (noteError) {
      console.error("[POST /api/public/inquiry] Contact note creation failed:", noteError);
      // Don't fail the whole request if note fails, but log it
    }

    // 4. Create a Todo task for the team
    const { error: todoError } = await admin
      .from("todos")
      .insert([
        {
          account_id: accountId,
          user_id: targetAgentUserId,
          title: `New Website Inquiry - @${name || phone}`,
          description: `Visitor ${name || ""} (${phone}) inquired about property: "${propertyTitle || "Unknown"}"${propertyCode ? ` (${propertyCode})` : ""}. Review contact and follow up.`,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // due in 1 day
          priority: "high",
          completed: false,
          contact_id: contactId,
          property_id: propertyId || null,
        },
      ]);

    if (todoError) {
      console.error("[POST /api/public/inquiry] Todo creation failed:", todoError);
    }

    // 5. Route the inquiry as an inbox message
    try {
      // Find or create conversation for the contact to show in the Inbox
      const { data: existingConv, error: findConvError } = await admin
        .from("conversations")
        .select("*")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .maybeSingle();

      let conversationId: string | undefined;
      let currentUnreadCount = 0;

      if (!findConvError && existingConv) {
        conversationId = existingConv.id;
        currentUnreadCount = existingConv.unread_count || 0;
      } else {
        const { data: newConv, error: createConvError } = await admin
          .from("conversations")
          .insert({
            account_id: accountId,
            user_id: targetAgentUserId,
            contact_id: contactId,
            unread_count: 0,
          })
          .select()
          .single();

        if (createConvError) {
          console.error("[POST /api/public/inquiry] Conversation creation failed:", createConvError);
        }
        conversationId = newConv?.id;
      }

      if (conversationId) {
        // Formulate inbox message text
        let inboxText = `📩 *Website Inquiry Received*\n\n`;
        if (propertyTitle) {
          inboxText += `🏡 *Property*: ${propertyTitle}${propertyCode ? ` (${propertyCode})` : ""}\n`;
        }
        if (message) {
          inboxText += `💬 *Message*: ${message.trim()}\n`;
        }
        if (email) {
          inboxText += `📧 *Email*: ${email.trim().toLowerCase()}\n`;
        }
        inboxText += `👤 *Name*: ${name || "Website Lead"}\n📞 *Phone*: ${normalizedPhone}`;

        // Insert message in messages table
        const { error: msgInsertError } = await admin.from("messages").insert({
          conversation_id: conversationId,
          sender_type: "customer",
          content_type: "text",
          content_text: inboxText,
          message_id: `web-inquiry-${Date.now()}`,
          status: "delivered",
          created_at: new Date().toISOString(),
        });

        if (msgInsertError) {
          console.error("[POST /api/public/inquiry] Inbox message insertion failed:", msgInsertError);
        } else {
          // Update conversation last_message_text, last_message_at, unread_count
          await admin
            .from("conversations")
            .update({
              last_message_text: inboxText,
              last_message_at: new Date().toISOString(),
              unread_count: currentUnreadCount + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", conversationId);
        }
      }
    } catch (inboxErr) {
      console.error("[POST /api/public/inquiry] Failed to route inquiry to inbox:", inboxErr);
    }

    return NextResponse.json({ success: true, contactId });
  } catch (err) {
    console.error("[POST /api/public/inquiry] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
