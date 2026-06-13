import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { normalizePhoneWithCountryCode } from "@/lib/whatsapp/phone-utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, message, propertyId, propertyTitle, accountId, referrerContactId } = body;

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

    const normalizedPhone = normalizePhoneWithCountryCode(phone, "91");
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

    // 2. Check if contact exists under this account
    const { data: existingContact, error: findError } = await admin
      .from("contacts")
      .select("id, name, email")
      .eq("account_id", accountId)
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (findError) {
      console.error("[POST /api/public/inquiry] Contact lookup failed:", findError);
      return NextResponse.json(
        { error: "Failed to process inquiry" },
        { status: 500 }
      );
    }

    let contactId: string;

    if (existingContact) {
      contactId = existingContact.id;
      
      // Update contact if name or email was empty
      const updates: Record<string, unknown> = {
        status: "pending_review",
        last_inquired_property_id: propertyId || null,
        updated_at: new Date().toISOString(),
      };
      if (!existingContact.name && name) updates.name = name.trim();
      if (!existingContact.email && email) updates.email = email.trim().toLowerCase();
      if (referrerContactId) updates.referrer_contact_id = referrerContactId;

      await admin
        .from("contacts")
        .update(updates)
        .eq("id", contactId);
    } else {
      // Create new contact
      const { data: newContact, error: createError } = await admin
        .from("contacts")
        .insert([
          {
            account_id: accountId,
            user_id: systemUserId,
            phone: normalizedPhone,
            name: (name || "Website Lead").trim(),
            email: email ? email.trim().toLowerCase() : null,
            classification: "Buyer",
            status: "pending_review",
            referrer: "Website Showcase",
            referrer_contact_id: referrerContactId || null,
            last_inquired_property_id: propertyId || null,
          },
        ])
        .select("id")
        .single();

      if (createError) {
        console.error("[POST /api/public/inquiry] Contact creation failed:", createError);
        return NextResponse.json(
          { error: "Failed to create contact" },
          { status: 500 }
        );
      }

      contactId = newContact.id;
    }

    // 3. Add inquiry details as a contact note
    let noteText = `Website Inquiry received:\n`;
    if (propertyTitle) {
      noteText += `• Interested in Property: ${propertyTitle}\n`;
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
          user_id: systemUserId,
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
          user_id: systemUserId,
          title: `New Website Inquiry - ${name || phone}`,
          description: `Visitor ${name || ""} (${phone}) inquired about property: "${propertyTitle || "Unknown"}". Review contact and follow up.`,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // due in 1 day
          priority: "high",
          completed: false,
        },
      ]);

    if (todoError) {
      console.error("[POST /api/public/inquiry] Todo creation failed:", todoError);
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
