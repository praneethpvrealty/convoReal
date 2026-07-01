import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { normalizePhoneWithCountryCode } from "@/lib/whatsapp/phone-utils";
import { assignTagsToContact } from "@/app/api/leads/email-webhook/db-utils";

function resolveBudgetVal(val: number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  if (val < 100) {
    return Math.round(val * 10000000); // Crores
  } else if (val < 10000) {
    return Math.round(val * 100000); // Lakhs
  }
  return val;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      name, 
      phone, 
      email, 
      categories, // string[]
      locations, // string[]
      minBudget, // number | null
      maxBudget, // number | null
      minRoi, // number | null
      notes, // string
      accountId, 
      referrerContactId 
    } = body;

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

    // 1. Fetch account owner to use as default user_id
    const { data: account, error: accountError } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", accountId)
      .maybeSingle();

    if (accountError || !account) {
      console.error("[POST /api/public/requirements] Account lookup failed:", accountError);
      return NextResponse.json(
        { error: "Invalid account ID" },
        { status: 400 }
      );
    }

    const systemUserId = account.owner_user_id;
    let targetAgentUserId = systemUserId;

    // Resolve target agent's user_id from the referrer contact ID
    if (referrerContactId) {
      const { data: refContact } = await admin
        .from("contacts")
        .select("email")
        .eq("id", referrerContactId)
        .maybeSingle();

      if (refContact?.email) {
        const { data: agentProfile } = await admin
          .from("profiles")
          .select("user_id")
          .eq("email", refContact.email)
          .maybeSingle();

        if (agentProfile?.user_id) {
          targetAgentUserId = agentProfile.user_id;
        }
      }
    }

    // 2. Check if contact exists under this account
    const { data: existingContacts, error: findError } = await admin
      .from("contacts")
      .select("id, name, email")
      .eq("account_id", accountId)
      .eq("phone", normalizedPhone);

    if (findError) {
      console.error("[POST /api/public/requirements] Contact lookup failed:", findError);
      return NextResponse.json(
        { error: "Failed to process requirements" },
        { status: 500 }
      );
    }

    const existingContact = existingContacts && existingContacts.length > 0 ? existingContacts[0] : null;
    let contactId: string;

    const resolvedMinBudget = resolveBudgetVal(minBudget);
    const resolvedMaxBudget = resolveBudgetVal(maxBudget);

    const contactFields = {
      name: (name || "Website Lead").trim(),
      email: email ? email.trim().toLowerCase() : null,
      classification: "Buyer" as const,
      status: "pending_review" as const,
      min_budget: resolvedMinBudget,
      max_budget: resolvedMaxBudget,
      areas_of_interest: locations || [],
      property_interests: categories || [],
      min_roi: minRoi || null,
      requirements: notes || null,
      referrer_contact_id: referrerContactId || null,
      updated_at: new Date().toISOString(),
    };

    if (existingContact) {
      contactId = existingContact.id;
      // Update existing contact preferences
      const updates: Record<string, unknown> = {
        ...contactFields,
        name: existingContact.name || contactFields.name,
        email: existingContact.email || contactFields.email,
      };

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
            user_id: targetAgentUserId,
            phone: normalizedPhone,
            referrer: "Website Requirements Form",
            ...contactFields,
          },
        ])
        .select("id")
        .single();

      if (createError) {
        console.error("[POST /api/public/requirements] Contact creation failed:", createError);
        return NextResponse.json(
          { error: "Failed to create contact" },
          { status: 500 }
        );
      }

      contactId = newContact.id;
    }

    // Auto-assign tags based on categories and budget
    const tagsToAssign: string[] = ["Website Lead"];
    
    // Add property type tags
    if (categories && categories.length > 0) {
      categories.forEach((cat: string) => {
        const catLower = cat.toLowerCase();
        if (catLower.includes('flat') || catLower.includes('apartment') || catLower.includes('bhk') || catLower.includes('penthouse') || catLower.includes('studio')) {
          if (!tagsToAssign.includes('Residential')) tagsToAssign.push('Residential');
          if (!tagsToAssign.includes('Flat/Apartment')) tagsToAssign.push('Flat/Apartment');
        } else if (catLower.includes('plot') || catLower.includes('land') || catLower.includes('site') || catLower.includes('agricultural')) {
          if (!tagsToAssign.includes('Plots/Land')) tagsToAssign.push('Plots/Land');
        } else if (catLower.includes('house') || catLower.includes('villa') || catLower.includes('farm house')) {
          if (!tagsToAssign.includes('Residential')) tagsToAssign.push('Residential');
          if (!tagsToAssign.includes('Villa')) tagsToAssign.push('Villa');
        } else if (catLower.includes('commercial') || catLower.includes('office') || catLower.includes('shop') || catLower.includes('showroom')) {
          if (!tagsToAssign.includes('Commercial')) tagsToAssign.push('Commercial');
        } else if (catLower.includes('industrial') || catLower.includes('industry') || catLower.includes('warehouse') || catLower.includes('factory') || catLower.includes('shed') || catLower.includes('godown')) {
          if (!tagsToAssign.includes('Industrial')) tagsToAssign.push('Industrial');
        }
      });
    }

    // Add budget-based tags
    if (resolvedMaxBudget) {
      if (resolvedMaxBudget >= 1500000000) tagsToAssign.push('Budget 150Cr+');
      else if (resolvedMaxBudget >= 1000000000) tagsToAssign.push('Budget 100-150Cr');
      else if (resolvedMaxBudget >= 500000000) tagsToAssign.push('Budget 50-100Cr');
      else if (resolvedMaxBudget >= 250000000) tagsToAssign.push('Budget 25-50Cr');
      else if (resolvedMaxBudget >= 100000000) tagsToAssign.push('Budget 10-25Cr');
      else if (resolvedMaxBudget >= 50000000) tagsToAssign.push('Budget 5-10Cr');
      else if (resolvedMaxBudget >= 20000000) tagsToAssign.push('Budget 2-5Cr');
      else if (resolvedMaxBudget >= 10000000) tagsToAssign.push('Budget 1-2Cr');
      else if (resolvedMaxBudget >= 5000000) tagsToAssign.push('Budget 50L-1Cr');
      else if (resolvedMaxBudget >= 2000000) tagsToAssign.push('Budget 20L-50L');
      else tagsToAssign.push('Budget <20L');
    }

    if (tagsToAssign.length > 0) {
      try {
        await assignTagsToContact(admin, accountId, targetAgentUserId, contactId, tagsToAssign);
      } catch (tagErr) {
        console.error("[POST /api/public/requirements] Failed to assign tags to contact:", tagErr);
      }
    }

    // 3. Add details as a contact note
    let noteText = `Website Requirements Profile Submitted:\n` +
      `• Budget: ${resolvedMinBudget ? `₹${resolvedMinBudget.toLocaleString('en-IN')}` : 'Any'} to ${resolvedMaxBudget ? `₹${resolvedMaxBudget.toLocaleString('en-IN')}` : 'Any'}\n` +
      `• Categories: ${(categories && categories.length > 0) ? categories.join(', ') : 'Any'}\n` +
      `• Locations: ${(locations && locations.length > 0) ? locations.join(', ') : 'Any'}\n`;
    if (minRoi) {
      noteText += `• Expected Min ROI/Yield: ${minRoi}%\n`;
    }
    if (notes) {
      noteText += `• Additional Notes: ${notes.trim()}\n`;
    }

    await admin
      .from("contact_notes")
      .insert([
        {
          account_id: accountId,
          contact_id: contactId,
          user_id: targetAgentUserId,
          note_text: noteText,
        },
      ]);

    // 4. Create a Todo task for the team
    await admin
      .from("todos")
      .insert([
        {
          account_id: accountId,
          user_id: targetAgentUserId,
          title: `New Buyer Requirements - @${name || phone}`,
          description: `Visitor ${name || ""} (${phone}) shared their requirements. Budget: ${resolvedMinBudget ? `₹${resolvedMinBudget.toLocaleString('en-IN')}` : 'Any'}-${resolvedMaxBudget ? `₹${resolvedMaxBudget.toLocaleString('en-IN')}` : 'Any'}. Locations: ${locations ? locations.join(', ') : 'Any'}. Follow up.`,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          priority: "high",
          completed: false,
          contact_id: contactId,
        },
      ]);

    // 5. Route the inquiry as an inbox message
    try {
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
        const { data: newConv } = await admin
          .from("conversations")
          .insert({
            account_id: accountId,
            user_id: targetAgentUserId,
            contact_id: contactId,
            unread_count: 0,
          })
          .select()
          .single();
        conversationId = newConv?.id;
      }

      if (conversationId) {
        const inboxText = `📋 *Property Requirements Submitted*\n\n` +
          ResolvedRequirementsInboxText(name, normalizedPhone, email, categories, locations, resolvedMinBudget || undefined, resolvedMaxBudget || undefined, minRoi, notes);

        const { error: msgInsertError } = await admin.from("messages").insert({
          conversation_id: conversationId,
          sender_type: "customer",
          content_type: "text",
          content_text: inboxText,
          message_id: `web-requirements-${Date.now()}`,
          status: "delivered",
          created_at: new Date().toISOString(),
        });

        if (!msgInsertError) {
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
      console.error("[POST /api/public/requirements] Failed to route to inbox:", inboxErr);
    }

    return NextResponse.json({ success: true, contactId });
  } catch (err) {
    console.error("[POST /api/public/requirements] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function ResolvedRequirementsInboxText(
  name: string,
  phone: string,
  email: string | undefined,
  categories: string[] | undefined,
  locations: string[] | undefined,
  minBudget: number | undefined,
  maxBudget: number | undefined,
  minRoi: number | undefined,
  notes: string | undefined
) {
  let text = `👤 *Name*: ${name || "Website Lead"}\n` +
    `📞 *Phone*: ${phone}\n`;
  if (email) text += `📧 *Email*: ${email.trim().toLowerCase()}\n`;
  text += `\n*Preferences*:\n` +
    `• Budget: ${minBudget ? `₹${minBudget.toLocaleString('en-IN')}` : 'Any'} - ${maxBudget ? `₹${maxBudget.toLocaleString('en-IN')}` : 'Any'}\n` +
    `• Categories: ${(categories && categories.length > 0) ? categories.join(', ') : 'Any'}\n` +
    `• Locations: ${(locations && locations.length > 0) ? locations.join(', ') : 'Any'}\n`;
  if (minRoi) {
    text += `• Min Yield ROI: ${minRoi}%\n`;
  }
  if (notes) {
    text += `💬 *Additional Notes*: ${notes.trim()}\n`;
  }
  return text;
}
