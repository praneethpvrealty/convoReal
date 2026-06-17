import { createClient } from '@supabase/supabase-js';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { 
  parseListingFromImageOrText, 
  updateListingDraft, 
  type ParsedPropertyDraft,
  classifyImageOrText,
  parseContactFromImageOrText,
  updateContactDraft,
  type ParsedContactDraft
} from '@/lib/ai/gemini';
import { uploadPropertyImage } from '@/lib/storage/upload';
import { 
  sendTextMessage, 
  downloadMedia, 
  getMediaUrl,
  sendInteractiveButtons
} from '@/lib/whatsapp/meta-api';

// Lazy initialize supabase admin client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * Checks if the sender's phone number belongs to the account owner of the current account.
 */
export async function checkIsAccountOwner(
  senderPhone: string,
  accountId: string
): Promise<{ isOwner: boolean; accountId?: string; userId?: string }> {
  try {
    const { data: ownerProfiles, error } = await supabaseAdmin()
      .from('profiles')
      .select('user_id, account_id, account_role, phone')
      .eq('account_id', accountId)
      .eq('account_role', 'owner');

    if (error || !ownerProfiles || ownerProfiles.length === 0) {
      if (error) {
        console.error('[chatbot-engine] Error querying owner profiles:', error);
      }
      return { isOwner: false };
    }

    const ownerProfile = ownerProfiles[0];
    if (ownerProfile.phone && phonesMatch(ownerProfile.phone, senderPhone)) {
      return { 
        isOwner: true, 
        accountId: ownerProfile.account_id, 
        userId: ownerProfile.user_id 
      };
    }
  } catch (err) {
    console.error('[chatbot-engine] Exception in checkIsAccountOwner:', err);
  }

  return { isOwner: false };
}

/**
 * Saves a bot reply message in the CRM database thread and updates the conversation state.
 */
async function saveBotMessage(
  conversationId: string,
  replyText: string
): Promise<void> {
  try {
    const { error: msgErr } = await supabaseAdmin()
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        message_id: `bot-${Date.now()}`,
        status: 'sent',
        created_at: new Date().toISOString()
      });

    if (msgErr) {
      console.error('[chatbot-engine] Error inserting bot message:', msgErr);
      return;
    }

    const { error: convErr } = await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: replyText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    if (convErr) {
      console.error('[chatbot-engine] Error updating conversation status:', convErr);
    }
  } catch (err) {
    console.error('[chatbot-engine] Exception in saveBotMessage:', err);
  }
}

/**
 * Validates the parsed draft to check for missing mandatory details.
 */
function validateDraft(draft: ParsedPropertyDraft): { 
  isValid: boolean; 
  missingFields: string[] 
} {
  const missingFields: string[] = [];
  if (!draft.title || draft.title.trim().length === 0) {
    missingFields.push('Title');
  }
  if (!draft.price || draft.price <= 0) {
    missingFields.push('Price');
  }
  if (!draft.location || draft.location.trim().length === 0) {
    missingFields.push('Location');
  }

  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

function formatDraftPreviewMessage(
  header: string,
  draft: ParsedPropertyDraft,
  nextStatus: string,
  missingFields: string[]
): string {
  let reply = `${header}\n\n` +
    `*Title:* ${draft.title || '❓ _Missing_'}\n` +
    `*Price:* ${draft.price ? '₹' + draft.price.toLocaleString('en-IN') : '❓ _Missing_'}\n` +
    `*Location:* ${draft.location || '❓ _Missing_'}\n` +
    `*Type:* ${draft.type || '❓ _Missing_'}\n` +
    `*Area:* ${draft.area_sqft ? draft.area_sqft + ' Sq.Ft.' : '_Not specified_'}\n` +
    `*Beds/Baths:* ${draft.bedrooms ? draft.bedrooms + ' BHK' : '_Not specified_'} / ${draft.bathrooms ? draft.bathrooms + ' Bath' : '_Not specified_'}\n`;

  if (draft.rental_income) {
    reply += `*Rent:* ₹${draft.rental_income.toLocaleString('en-IN')}/month\n`;
  }
  if (draft.roi) {
    reply += `*ROI (Yield):* ${draft.roi}%\n`;
  }

  reply += `*Images:* ${draft.images.length} attached\n\n` +
    (nextStatus === 'awaiting_confirmation'
      ? "✅ All mandatory fields populated!\n• Use the buttons below to Confirm or Cancel.\n• Send more updates to correct details."
      : `⚠️ *Still missing:* ${missingFields.join(', ')}.\n• Use the Cancel button below to discard.\n• Reply with details to complete.`);

  return reply;
}

async function sendPropertyDraftPreview(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  header: string,
  draft: ParsedPropertyDraft,
  nextStatus: string,
  missingFields: string[],
  conversationId: string
): Promise<void> {
  const reply = formatDraftPreviewMessage(header, draft, nextStatus, missingFields);
  
  const buttons = nextStatus === 'awaiting_confirmation'
    ? [
        { id: 'confirm_property', title: 'Confirm' },
        { id: 'cancel_property', title: 'Cancel' }
      ]
    : [
        { id: 'cancel_property', title: 'Cancel' }
      ];

  await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to,
    bodyText: reply,
    buttons
  });

  await saveBotMessage(conversationId, reply);
}

function validateContactDraft(draft: ParsedContactDraft): { 
  isValid: boolean; 
  missingFields: string[] 
} {
  const missingFields: string[] = [];
  if (!draft.name || draft.name.trim().length === 0) {
    missingFields.push('Name');
  }
  if (!draft.phone || draft.phone.trim().length === 0) {
    missingFields.push('Phone');
  }

  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

function formatContactDraftPreview(
  header: string,
  draft: ParsedContactDraft,
  nextStatus: string,
  missingFields: string[]
): string {
  const reply = `${header}\n\n` +
    `*Name:* ${draft.name || '❓ _Missing_'}\n` +
    `*Phone:* ${draft.phone || '❓ _Missing_'}\n` +
    `*Email:* ${draft.email || '_Not specified_'}\n` +
    `*Company:* ${draft.company || '_Not specified_'}\n` +
    `*Role/Classification:* ${draft.classification || 'Others'}\n` +
    `*Notes:* ${draft.notes || '_No notes_'}\n\n` +
    (nextStatus === 'awaiting_confirmation'
      ? "✅ All mandatory fields populated!\n• Use the buttons below to Confirm or Cancel.\n• Send updates to correct details."
      : `⚠️ *Still missing:* ${missingFields.join(', ')}.\n• Use the Cancel button below to discard.\n• Reply with details to complete.`);

  return reply;
}

async function sendContactDraftPreview(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  header: string,
  draft: ParsedContactDraft,
  nextStatus: string,
  missingFields: string[],
  conversationId: string
): Promise<void> {
  const reply = formatContactDraftPreview(header, draft, nextStatus, missingFields);
  
  const buttons = nextStatus === 'awaiting_confirmation'
    ? [
        { id: 'confirm_contact', title: 'Confirm' },
        { id: 'cancel_contact', title: 'Cancel' }
      ]
    : [
        { id: 'cancel_contact', title: 'Cancel' }
      ];

  await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to,
    bodyText: reply,
    buttons
  });

  await saveBotMessage(conversationId, reply);
}

/**
 * Core processor for owner chatbot messages.
 * Returns true if the message was handled/consumed by the chatbot engine, false otherwise.
 */
export async function processOwnerChatbotMessage(
  message: { 
    id: string; 
    type: string; 
    image?: { id: string; mime_type: string };
    interactive?: {
      type: 'button_reply' | 'list_reply';
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
    };
  },
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string },
  conversation: { id: string; unread_count: number },
  accountId: string,
  userId: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  // 1. Fetch active sessions for this contact
  const { data: propSession, error: propSessionErr } = await supabaseAdmin()
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .maybeSingle();

  const { data: contactSession, error: contactSessionErr } = await supabaseAdmin()
    .from('contact_draft_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .maybeSingle();

  if (propSessionErr) {
    console.error('[chatbot-engine] Error fetching property draft session:', propSessionErr);
  }
  if (contactSessionErr) {
    console.error('[chatbot-engine] Error fetching contact draft session:', contactSessionErr);
  }

  const cleanedText = contentText?.trim() || '';
  const lowerText = cleanedText.toLowerCase();

  const buttonId = message.type === 'interactive'
    ? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id
    : null;

  // 2. Active Property Session Exists Flow
  if (propSession) {
    const draft = propSession.draft_data as ParsedPropertyDraft;

    // Handle CANCEL instruction
    if (buttonId === 'cancel_property' || lowerText === 'cancel') {
      await supabaseAdmin()
        .from('property_draft_sessions')
        .delete()
        .eq('id', propSession.id);

      const reply = "❌ *Property draft discarded.* Send another property details text or listing screenshot to start a new draft.";
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    // Handle CONFIRM instruction
    if (buttonId === 'confirm_property' || lowerText === 'confirm') {
      const { isValid, missingFields } = validateDraft(draft);
      if (!isValid) {
        const reply = `⚠️ *Cannot confirm yet.* The following mandatory fields are missing:\n\n` +
          missingFields.map(f => `• *${f}*`).join('\n') +
          `\n\nPlease provide them first (e.g. 'price is 1.5 Cr', 'title is HSR 3BHK Apartment').`;
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }

      // Create new property in inventory
      const { data: prop, error: propErr } = await supabaseAdmin()
        .from('properties')
        .insert({
          account_id: accountId,
          user_id: userId,
          title: draft.title!.trim(),
          description: draft.description || `Ingested automatically via WhatsApp chatbot.`,
          price: draft.price,
          location: draft.location!.trim(),
          type: draft.type || 'Others',
          status: 'Available',
          bedrooms: draft.bedrooms,
          bathrooms: draft.bathrooms,
          area_sqft: draft.area_sqft,
          sublocality: draft.sublocality,
          city: draft.city || 'Bangalore',
          state: draft.state || 'Karnataka',
          dimensions: draft.dimensions,
          facing_direction: draft.facing_direction,
          is_published: true,
          features: draft.features || [],
          images: draft.images || [],
          rental_income: draft.rental_income,
          roi: draft.roi
        })
        .select()
        .single();

      if (propErr) {
        console.error('[chatbot-engine] Failed to save property:', propErr);
        const reply = "❌ *Error saving property to database.* Please try again later.";
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }

      // Delete active draft session
      await supabaseAdmin()
        .from('property_draft_sessions')
        .delete()
        .eq('id', propSession.id);

      let reply = `✅ *Property listing created successfully!*\n\n` +
        `*Code:* ${prop.property_code}\n` +
        `*Title:* ${prop.title}\n` +
        `*Price:* ₹${prop.price.toLocaleString('en-IN')}\n` +
        `*Location:* ${prop.location}\n`;

      if (prop.rental_income) {
        reply += `*Rent:* ₹${prop.rental_income.toLocaleString('en-IN')}/month\n`;
      }
      if (prop.roi) {
        reply += `*ROI (Yield):* ${prop.roi}%\n`;
      }

      reply += `\nView it in your dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/inventory`;
        
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    // Handle image upload inside active session
    if (message.type === 'image' && message.image?.id) {
      // Prompt user that we are downloading/uploading
      await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: "⏳ _Uploading photo to draft listing... Please wait._"
      });

      try {
        const mediaId = message.image.id;
        const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
        const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
        
        const publicUrl = await uploadPropertyImage(accountId, buffer, mimeType);
        
        const updatedImages = [...(draft.images || []), publicUrl];
        const updatedDraft = { ...draft, images: updatedImages };
        
        const { isValid, missingFields } = validateDraft(updatedDraft);
        const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        await supabaseAdmin()
          .from('property_draft_sessions')
          .update({
            draft_data: updatedDraft,
            status: nextStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', propSession.id);

        await sendPropertyDraftPreview(
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📸 *Photo added successfully!* Total photos attached: *${updatedImages.length}*.`,
          updatedDraft,
          nextStatus,
          missingFields,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error processing photo upload:', err);
        const reply = "❌ *Failed to upload image.* Please verify the photo format and try again.";
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }
    }

    // Handle conversational update/correction text
    if (cleanedText) {
      const updatedDraft = await updateListingDraft(draft, cleanedText);
      const { isValid, missingFields } = validateDraft(updatedDraft);
      const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

      await supabaseAdmin()
        .from('property_draft_sessions')
        .update({
          draft_data: updatedDraft,
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', propSession.id);

      await sendPropertyDraftPreview(
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📝 *Draft Listing Updated:*`,
        updatedDraft,
        nextStatus,
        missingFields,
        conversation.id
      );
      return true;
    }

    return true;
  }

  // 3. Active Contact Session Exists Flow
  if (contactSession) {
    const draft = contactSession.draft_data as ParsedContactDraft;

    // Handle CANCEL instruction
    if (buttonId === 'cancel_contact' || lowerText === 'cancel') {
      await supabaseAdmin()
        .from('contact_draft_sessions')
        .delete()
        .eq('id', contactSession.id);

      const reply = "❌ *Contact draft discarded.* Send another contact text details or screenshot to start a new contact draft.";
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    // Handle CONFIRM instruction
    if (buttonId === 'confirm_contact' || lowerText === 'confirm') {
      const { isValid, missingFields } = validateContactDraft(draft);
      if (!isValid) {
        const reply = `⚠️ *Cannot confirm yet.* The following fields are missing:\n\n` +
          missingFields.map(f => `• *${f}*`).join('\n') +
          `\n\nPlease provide them first (e.g. 'name is Ramesh').`;
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }

      // Check if contact already exists
      const cleanPhone = draft.phone!.replace(/\D/g, '');
      const { data: existingContact } = await supabaseAdmin()
        .from('contacts')
        .select('id, name')
        .eq('account_id', accountId)
        .or(`phone.eq.${draft.phone},phone.eq.${cleanPhone}`)
        .maybeSingle();

      if (existingContact) {
        const reply = `⚠️ *Contact already exists in CRM:* ${existingContact.name}. Contact draft discarded.`;
        await supabaseAdmin()
          .from('contact_draft_sessions')
          .delete()
          .eq('id', contactSession.id);
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }

      // Create new contact in CRM
      const { data: contact, error: contactErr } = await supabaseAdmin()
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          name: draft.name!.trim(),
          phone: draft.phone!.trim(),
          email: draft.email || null,
          company: draft.company || '',
          classification: draft.classification || 'Others',
          status: 'pending_review',
          source: 'WhatsApp'
        })
        .select()
        .single();

      if (contactErr) {
        console.error('[chatbot-engine] Failed to save contact:', contactErr);
        const reply = "❌ *Error saving contact to database.* Please try again later.";
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }

      // Delete contact draft session
      await supabaseAdmin()
        .from('contact_draft_sessions')
        .delete()
        .eq('id', contactSession.id);

      const reply = `✅ *Contact created successfully!*\n\n` +
        `*Name:* ${contact.name}\n` +
        `*Phone:* ${contact.phone}\n` +
        `*Role/Classification:* ${contact.classification}\n` +
        `*Email:* ${contact.email || '_None_'}\n\n` +
        `View in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts`;
        
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    // Handle conversational updates to contact draft
    if (cleanedText) {
      const updatedDraft = await updateContactDraft(draft, cleanedText);
      const { isValid, missingFields } = validateContactDraft(updatedDraft);
      const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

      await supabaseAdmin()
        .from('contact_draft_sessions')
        .update({
          draft_data: updatedDraft,
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactSession.id);

      await sendContactDraftPreview(
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📝 *Contact Draft Updated:*`,
        updatedDraft,
        nextStatus,
        missingFields,
        conversation.id
      );
      return true;
    }

    return true;
  }

  // 4. Start New Session Flow (No Session Exists)
  const isImageMsg = message.type === 'image' && message.image?.id;
  
  if (isImageMsg || cleanedText) {
    let mediaBuffer: Buffer | undefined = undefined;
    let mediaMimeType: string | undefined = undefined;

    if (isImageMsg) {
      const mediaId = message.image!.id;
      const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
      mediaBuffer = buffer;
      mediaMimeType = mimeType;
    }

    const classification = await classifyImageOrText(cleanedText, mediaBuffer, mediaMimeType);

    // --- PROPERTY INGESTION FLOW ---
    if (classification === 'property') {
      await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: "⏳ _Analyzing listing details... Please wait._"
      });

      try {
        let parsedDraft: ParsedPropertyDraft;
        const uploadedImages: string[] = [];

        if (isImageMsg && mediaBuffer && mediaMimeType) {
          // Parallel parse and upload to save latency
          const [parsed, publicUrl] = await Promise.all([
            parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType),
            uploadPropertyImage(accountId, mediaBuffer, mediaMimeType)
          ]);

          parsedDraft = parsed;
          uploadedImages.push(publicUrl);
          parsedDraft.images = uploadedImages;
        } else {
          parsedDraft = await parseListingFromImageOrText(cleanedText);
          parsedDraft.images = [];
        }

        const { isValid, missingFields } = validateDraft(parsedDraft);
        const initialStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        // Insert new active session
        await supabaseAdmin()
          .from('property_draft_sessions')
          .insert({
            account_id: accountId,
            contact_id: contactRecord.id,
            draft_data: parsedDraft,
            status: initialStatus
          });

        await sendPropertyDraftPreview(
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📝 *Draft Property Listing Created!*`,
          parsedDraft,
          initialStatus,
          missingFields,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error initializing property draft session:', err);
        const reply = "❌ *Failed to parse listing.* Please copy paste details as text or send a clean property advertisement image.";
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }
    }

    // --- CONTACT INGESTION FLOW ---
    if (classification === 'contact') {
      await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: "⏳ _Analyzing contact details... Please wait._"
      });

      try {
        let parsedDraft: ParsedContactDraft;

        if (isImageMsg && mediaBuffer && mediaMimeType) {
          parsedDraft = await parseContactFromImageOrText(contentText || '', mediaBuffer, mediaMimeType);
        } else {
          parsedDraft = await parseContactFromImageOrText(cleanedText);
        }

        const { isValid, missingFields } = validateContactDraft(parsedDraft);
        const initialStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        // Insert new active session
        await supabaseAdmin()
          .from('contact_draft_sessions')
          .insert({
            account_id: accountId,
            contact_id: contactRecord.id,
            draft_data: parsedDraft,
            status: initialStatus
          });

        await sendContactDraftPreview(
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📝 *Contact Draft Created!*`,
          parsedDraft,
          initialStatus,
          missingFields,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error initializing contact draft session:', err);
        const reply = "❌ *Failed to parse contact details.* Please copy paste details as text or send a clean contact screenshot.";
        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
        return true;
      }
    }
  }

  // Handle help command or general welcome instructions
  if (lowerText === 'help' || cleanedText) {
    const reply = `👋 *AI Ingestion Chatbot*\n\n` +
      `Send property listing details or a contact profile (as text or screenshot) to automatically start a draft.\n\n` +
      `*Commands:* (only active during an active session)\n` +
      `• Send property photos to add them to listing\n` +
      `• Reply naturally to correct details (e.g., 'price is 1.8 Cr' or 'name is Suresh')\n` +
      `• Click the **Cancel** button to discard\n` +
      `• Click the **Confirm** button to save`;

    await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply);
    return true;
  }

  return false;
}
