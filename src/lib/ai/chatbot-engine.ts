import { createClient } from '@supabase/supabase-js';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { 
  isListingMessage, 
  parseListingFromImageOrText, 
  updateListingDraft, 
  type ParsedPropertyDraft 
} from '@/lib/ai/gemini';
import { uploadPropertyImage } from '@/lib/storage/upload';
import { 
  sendTextMessage, 
  downloadMedia, 
  getMediaUrl 
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
 * Checks if the sender's phone number belongs to the account owner (profile.account_role = 'owner').
 */
export async function checkIsAccountOwner(
  senderPhone: string
): Promise<{ isOwner: boolean; accountId?: string; userId?: string }> {
  const normalizedSender = senderPhone.replace(/\D/g, '');
  const phoneSuffix = normalizedSender.length >= 8 ? normalizedSender.slice(-8) : normalizedSender;

  try {
    const { data: ownerProfiles, error } = await supabaseAdmin()
      .from('profiles')
      .select('user_id, account_id, account_role, phone')
      .eq('account_role', 'owner')
      .like('phone', `%${phoneSuffix}`);

    if (error || !ownerProfiles) {
      console.error('[chatbot-engine] Error querying owner profiles:', error);
      return { isOwner: false };
    }

    const ownerProfile = ownerProfiles.find((p: { phone?: string | null }) => 
      p.phone && phonesMatch(p.phone, senderPhone)
    );

    if (ownerProfile) {
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

/**
 * Core processor for owner chatbot messages.
 * Returns true if the message was handled/consumed by the chatbot engine, false otherwise.
 */
export async function processOwnerChatbotMessage(
  message: { id: string; type: string; image?: { id: string; mime_type: string } },
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string },
  conversation: { id: string; unread_count: number },
  accountId: string,
  userId: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  // 1. Fetch active session for this contact
  const { data: session, error: sessionErr } = await supabaseAdmin()
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .maybeSingle();

  if (sessionErr) {
    console.error('[chatbot-engine] Error fetching draft session:', sessionErr);
  }

  const cleanedText = contentText?.trim() || '';
  const lowerText = cleanedText.toLowerCase();

  // 2. Active Session Exists Flow
  if (session) {
    const draft = session.draft_data as ParsedPropertyDraft;

    // Handle CANCEL instruction
    if (lowerText === 'cancel') {
      await supabaseAdmin()
        .from('property_draft_sessions')
        .delete()
        .eq('id', session.id);

      const reply = "❌ *Draft discarded.* Send another property details text or listing screenshot to start a new draft.";
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    // Handle CONFIRM instruction
    if (lowerText === 'confirm') {
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
          images: draft.images || []
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
        .eq('id', session.id);

      const reply = `✅ *Property listing created successfully!*\n\n` +
        `*Code:* ${prop.property_code}\n` +
        `*Title:* ${prop.title}\n` +
        `*Price:* ₹${prop.price.toLocaleString('en-IN')}\n` +
        `*Location:* ${prop.location}\n\n` +
        `View it in your dashboard: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/inventory`;
        
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
          .eq('id', session.id);

        const reply = `📸 *Photo added successfully!*\n` +
          `Total photos attached: *${updatedImages.length}*.\n\n` +
          (nextStatus === 'awaiting_confirmation'
            ? "✅ All mandatory fields populated!\nReply *confirm* to save to inventory."
            : `⚠️ *Still missing:* ${missingFields.join(', ')}.\nReply with the details.`);

        await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply);
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
        .eq('id', session.id);

      const reply = `📝 *Draft Listing Updated:*\n\n` +
        `*Title:* ${updatedDraft.title || '❓ _Missing_'}\n` +
        `*Price:* ${updatedDraft.price ? '₹' + updatedDraft.price.toLocaleString('en-IN') : '❓ _Missing_'}\n` +
        `*Location:* ${updatedDraft.location || '❓ _Missing_'}\n` +
        `*Type:* ${updatedDraft.type || '❓ _Missing_'}\n` +
        `*Area:* ${updatedDraft.area_sqft ? updatedDraft.area_sqft + ' Sq.Ft.' : '_Not specified_'}\n` +
        `*Beds/Baths:* ${updatedDraft.bedrooms ? updatedDraft.bedrooms + ' BHK' : '_Not specified_'} / ${updatedDraft.bathrooms ? updatedDraft.bathrooms + ' Bath' : '_Not specified_'}\n` +
        `*Images:* ${updatedDraft.images.length} attached\n\n` +
        (nextStatus === 'awaiting_confirmation'
          ? "✅ All mandatory fields populated!\n• Reply *confirm* to save.\n• Reply *cancel* to discard.\n• Send more updates to correct details."
          : `⚠️ *Still missing:* ${missingFields.join(', ')}.\nReply with details.`);

      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }

    return true;
  }

  // 3. Start New Session Flow (No Session Exists)
  const isImageMsg = message.type === 'image' && message.image?.id;
  const isTextListing = cleanedText && await isListingMessage(cleanedText);

  if (isImageMsg || isTextListing) {
    // Notify parsing started
    await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: contactRecord.phone,
      text: "⏳ _Analyzing listing details... Please wait._"
    });

    try {
      let parsedDraft: ParsedPropertyDraft;
      const uploadedImages: string[] = [];

      if (isImageMsg) {
        const mediaId = message.image!.id;
        const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
        const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
        
        // Parallel parse and upload to save latency
        const [parsed, publicUrl] = await Promise.all([
          parseListingFromImageOrText(contentText || '', buffer, mimeType),
          uploadPropertyImage(accountId, buffer, mimeType)
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

      const reply = `📝 *Draft Property Listing Created!*\n\n` +
        `*Title:* ${parsedDraft.title || '❓ _Missing_'}\n` +
        `*Price:* ${parsedDraft.price ? '₹' + parsedDraft.price.toLocaleString('en-IN') : '❓ _Missing_'}\n` +
        `*Location:* ${parsedDraft.location || '❓ _Missing_'}\n` +
        `*Type:* ${parsedDraft.type || '❓ _Missing_'}\n` +
        `*Area:* ${parsedDraft.area_sqft ? parsedDraft.area_sqft + ' Sq.Ft.' : '_Not specified_'}\n` +
        `*Beds/Baths:* ${parsedDraft.bedrooms ? parsedDraft.bedrooms + ' BHK' : '_Not specified_'} / ${parsedDraft.bathrooms ? parsedDraft.bathrooms + ' Bath' : '_Not specified_'}\n` +
        `*Images:* ${parsedDraft.images.length} attached\n\n` +
        (initialStatus === 'awaiting_confirmation'
          ? "✅ All mandatory fields populated!\n• Reply *confirm* to save to inventory.\n• Send property photos to add them.\n• Reply naturally to correct fields."
          : `⚠️ *Missing mandatory fields:* ${missingFields.join(', ')}.\nReply with details (e.g. 'price is 1.5 Cr', 'title is HSR 3BHK').`);

      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    } catch (err) {
      console.error('[chatbot-engine] Error initializing draft parsing session:', err);
      const reply = "❌ *Failed to parse listing.* Please copy paste details as text or send a clean property advertisement image.";
      await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply);
      return true;
    }
  }

  // Handle help command or general welcome instructions
  if (lowerText === 'help' || cleanedText) {
    const reply = `👋 *AI Property Ingestion Chatbot*\n\n` +
      `Send a property listing details (text) or a screenshot of the listing to automatically start an inventory draft.\n\n` +
      `*Commands:* (only active during active session)\n` +
      `• Send property photos to add them\n` +
      `• Reply naturally to correct details (e.g., 'price is 1.8 Cr')\n` +
      `• Reply *cancel* to discard\n` +
      `• Reply *confirm* to save to your inventory`;

    await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply);
    return true;
  }

  return false;
}
