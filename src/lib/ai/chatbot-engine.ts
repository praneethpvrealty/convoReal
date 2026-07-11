import { createClient } from '@supabase/supabase-js';
import { phonesMatch, normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import type { Contact } from '@/types';
import { 
  parseListingFromImageOrText, 
  updateListingDraft, 
  type ParsedPropertyDraft,
  classifyImageOrText,
  parseContactFromImageOrText,
  updateContactDraft,
  type ParsedContactDraftsContainer,
  normalizeClassification
} from '@/lib/ai/gemini';
import { uploadPropertyImage } from '@/lib/storage/upload';
import { 
  sendTextMessage, 
  downloadMedia, 
  getMediaUrl,
  sendInteractiveButtons
} from '@/lib/whatsapp/meta-api';
import { autoSyncPropertyCatalogIfNeeded } from '@/lib/whatsapp/catalog-sync-helper';
import { extractImagesFromPdf } from '@/lib/pdf/image-extractor';
import { checkAccountPropertyLimit } from '@/lib/billing/gates';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS, type AiFeatureKey } from '@/lib/credits/types';
import { notifyManagerLowBalance } from '@/lib/credits/notify';
import {
  validateDraft,
  validateContactDraftsContainer,
  formatDraftPreviewMessage,
  formatContactDraftsPreview,
  backfillLocationFromMapLink,
  mergeContactDraftsContainer,
} from '@/lib/ai/intake-core';

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

// Debounces the low-balance WhatsApp ping per account so a Manager
// isn't paged on every single inbound message once their balance
// settles under a threshold — one notice per threshold band per
// 6-hour window is enough to be actionable without being noisy.
const lowBalanceNotifiedAt = new Map<string, number>();
const LOW_BALANCE_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function notifyBalanceThreshold(accountId: string, result: { deficit: number; balanceAfter: number }): void {
  const threshold: 'zero' | 'critical' | 'low' | null =
    result.deficit > 0 || result.balanceAfter <= 0
      ? 'zero'
      : result.balanceAfter <= 20
        ? 'critical'
        : result.balanceAfter <= 100
          ? 'low'
          : null;

  if (threshold) {
    const lastNotified = lowBalanceNotifiedAt.get(accountId) ?? 0;
    if (Date.now() - lastNotified > LOW_BALANCE_NOTIFY_COOLDOWN_MS) {
      lowBalanceNotifiedAt.set(accountId, Date.now());
      void notifyManagerLowBalance(accountId, result.balanceAfter, threshold);
    }
  }
}

/**
 * Soft-block credit burn — never throws, never blocks. Only for the
 * external-contact engine (processExternalListingMessage): those
 * inbound messages come from prospects, so a credit shortfall must
 * not silently kill lead automation; a deficit is only logged.
 */
async function softBurn(accountId: string, feature: AiFeatureKey): Promise<void> {
  try {
    const result = await burnCredits(accountId, feature, AI_FEATURE_COSTS[feature], { hardBlock: false });
    if (result.deficit > 0) {
      console.warn(`[chatbot-engine] credit deficit for account ${accountId}: ${result.deficit} short on '${feature}'`);
    }
    notifyBalanceThreshold(accountId, result);
  } catch (err) {
    console.error(`[chatbot-engine] softBurn failed (non-fatal) for '${feature}':`, err);
  }
}

/**
 * Hard-block credit burn for the owner chatbot. The account owner is
 * watching this chat and is told "AI features are now locked" at zero
 * balance, so the lock has to be real: returns false when the AI call
 * must be skipped (nothing was deducted). Billing-infra errors fail
 * open — the bot must not go down because billing did.
 */
async function gatedBurn(accountId: string, feature: AiFeatureKey): Promise<boolean> {
  try {
    const result = await burnCredits(accountId, feature, AI_FEATURE_COSTS[feature], { hardBlock: true });
    notifyBalanceThreshold(accountId, result);
    if (!result.success) {
      console.warn(`[chatbot-engine] blocked '${feature}' for account ${accountId}: ${result.deficit} credits short`);
    }
    return result.success;
  } catch (err) {
    console.error(`[chatbot-engine] gatedBurn failed (fail-open) for '${feature}':`, err);
    return true;
  }
}

const CREDITS_LOCKED_REPLY =
  "🔒 *Out of AI credits — this message wasn't processed.* Buy more credits or upgrade your plan from the dashboard to unlock AI features.";

async function sendCreditsLockedReply(
  phoneNumberId: string,
  accessToken: string,
  toPhone: string,
  conversationId: string
): Promise<true> {
  const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: toPhone, text: CREDITS_LOCKED_REPLY });
  await saveBotMessage(conversationId, CREDITS_LOCKED_REPLY, sendRes.messageId);
  return true;
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
  replyText: string,
  metaMessageId?: string
): Promise<void> {
  try {
    const { error: msgErr } = await supabaseAdmin()
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        message_id: metaMessageId || `bot-${Date.now()}`,
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

  const sendRes = await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to,
    bodyText: reply,
    buttons
  });

  await saveBotMessage(conversationId, reply, sendRes.messageId);
}

async function sendPropertyDraftPreviewDebounced(
  sessionId: string,
  updatedAtString: string,
  phoneNumberId: string,
  accessToken: string,
  to: string,
  header: string,
  conversationId: string
): Promise<void> {
  try {
    // Wait 4 seconds for concurrent uploads/messages to settle
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Query database to see if a newer update was made
    const { data: currentSession } = await supabaseAdmin()
      .from('property_draft_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    // If session was deleted (confirmed/cancelled) or has a newer timestamp, exit silently
    if (!currentSession) return;
    
    const dbTime = new Date(currentSession.updated_at).getTime();
    const ourTime = new Date(updatedAtString).getTime();

    // Allow a tiny tolerance (e.g. 50ms) for clock drift, but generally dbTime > ourTime means newer update exists
    if (dbTime > ourTime + 50) {
      console.log(`[chatbot-engine] Newer update detected (DB: ${currentSession.updated_at}, Ours: ${updatedAtString}). Skipping preview in this thread.`);
      return;
    }

    // We are the latest thread! Send the preview with the latest data from the DB
    const latestDraft = currentSession.draft_data as ParsedPropertyDraft;
    const validation = validateDraft(latestDraft);
    const nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';
    const missingFields = validation.missingFields;

    // Customize header count of images
    let finalHeader = header;
    if (header.includes('Photo added successfully') || header.includes('Photos added successfully')) {
      finalHeader = `📸 *Photos added successfully!* Total photos attached: *${latestDraft.images.length}*.`;
    }

    await sendPropertyDraftPreview(
      phoneNumberId,
      accessToken,
      to,
      finalHeader,
      latestDraft,
      nextStatus,
      missingFields,
      conversationId
    );
  } catch (err) {
    console.error('[chatbot-engine] Error in sendPropertyDraftPreviewDebounced:', err);
  }
}

/**
 * Data concern kept out of the pure formatter: for each parsed contact
 * draft, look up whether a contact with the same phone (or, failing
 * that, name) already exists in this account. Returns an index-aligned
 * array of WhatsApp-markdown warning strings (`null` when no
 * duplicate). Per-contact errors are swallowed (logged, treated as no
 * duplicate) so a lookup failure never blocks the preview.
 */
async function computeContactDuplicateWarnings(
  container: ParsedContactDraftsContainer,
  accountId: string
): Promise<(string | null)[]> {
  const contacts = container.contacts ?? [];
  return Promise.all(
    contacts.map(async (draft) => {
      if (!draft.phone && !draft.name) return null;
      try {
        let existingContact = null;
        let matchType = '';

        if (draft.phone) {
          const normalized = normalizePhoneWithCountryCode(draft.phone, '91');
          const cleanPhone = normalized.replace(/\D/g, '');
          const { data: byPhone } = await supabaseAdmin()
            .from('contacts')
            .select('id, name')
            .eq('account_id', accountId)
            .or(`phone.eq.${draft.phone},phone.eq.${normalized},phone.eq.${cleanPhone}`)
            .maybeSingle();

          if (byPhone) {
            existingContact = byPhone;
            matchType = 'phone';
          }
        }

        if (!existingContact && draft.name) {
          const { data: byName } = await supabaseAdmin()
            .from('contacts')
            .select('id, name')
            .eq('account_id', accountId)
            .ilike('name', draft.name.trim())
            .maybeSingle();

          if (byName) {
            existingContact = byName;
            matchType = 'name';
          }
        }

        if (existingContact) {
          return matchType === 'phone'
            ? `\n⚠️ *The contact with phone number ${draft.phone} already exists as "${existingContact.name}". Please type different number and try again.*`
            : `\n⚠️ *The contact with Name "${draft.name}" already exists. Please type different name and try again.*`;
        }
      } catch (err) {
        console.error('[chatbot-engine] Error checking duplicate contacts:', err);
      }
      return null;
    })
  );
}

async function formatContactDraftsContainerPreview(
  header: string,
  container: ParsedContactDraftsContainer,
  nextStatus: string,
  missingFields: string[],
  accountId: string
): Promise<string> {
  const duplicateWarnings = await computeContactDuplicateWarnings(container, accountId);
  return formatContactDraftsPreview(header, container, nextStatus, missingFields, duplicateWarnings);
}

async function sendContactDraftPreview(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  header: string,
  container: ParsedContactDraftsContainer,
  nextStatus: string,
  missingFields: string[],
  conversationId: string,
  accountId: string
): Promise<void> {
  const reply = await formatContactDraftsContainerPreview(header, container, nextStatus, missingFields, accountId);
  
  const buttons = nextStatus === 'awaiting_confirmation'
    ? [
        { id: 'confirm_contact', title: 'Confirm' },
        { id: 'cancel_contact', title: 'Cancel' }
      ]
    : [
        { id: 'cancel_contact', title: 'Cancel' }
      ];

  const sendRes = await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to,
    bodyText: reply,
    buttons
  });

  await saveBotMessage(conversationId, reply, sendRes.messageId);
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
    document?: { id: string; mime_type: string; filename?: string };
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
  const { data: propSessionData, error: propSessionErr } = await supabaseAdmin()
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .maybeSingle();

  const { data: contactSessionData, error: contactSessionErr } = await supabaseAdmin()
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

  let propSession = propSessionData;
  let contactSession = contactSessionData;

  const cleanedText = contentText?.trim() || '';
  const lowerText = cleanedText.toLowerCase();

  const isImageMsg = message.type === 'image' && message.image?.id;
  const isDocMsg = message.type === 'document' && message.document?.id;
  const isMediaMsg = isImageMsg || isDocMsg;

  // Concurrency check: If there is no active session yet, and we are either an image/document message or
  // a text message that is NOT a property initiator (e.g. location map link or quick correction),
  // we check if another customer message arrived in the same conversation within the last 15s.
  // If so, we poll and wait up to 8 seconds for the concurrent initiator thread to parse and insert the session.
  const isInitiator = !isMediaMsg && (
    cleanedText.length > 15 && 
    ["bhk", "sqft", "flat", "plot", "villa", "sale", "rent", "layout", "crore", "lakh", "price", "location", "acres", "commercial", "industrial", "built", "structure", "facing"].some(kw => lowerText.includes(kw))
  );

  const shouldPoll = !propSession && !contactSession && (isMediaMsg || !isInitiator) && (isMediaMsg || cleanedText);

  if (shouldPoll) {
    try {
      const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000).toISOString();
      const { data: recentMsgs } = await supabaseAdmin()
        .from('messages')
        .select('id, created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .gt('created_at', fifteenSecondsAgo)
        .order('created_at', { ascending: false });

      if (recentMsgs && recentMsgs.length > 1) {
        console.log(`[chatbot-engine] Concurrent messages detected (${recentMsgs.length}). Polling for session creation...`);
        let pollCount = 0;
        const maxPolls = 16; // 16 * 500ms = 8 seconds
        while (pollCount < maxPolls && !propSession && !contactSession) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          const { data: latestProp } = await supabaseAdmin()
            .from('property_draft_sessions')
            .select('*')
            .eq('contact_id', contactRecord.id)
            .maybeSingle();
            
          const { data: latestContact } = await supabaseAdmin()
            .from('contact_draft_sessions')
            .select('*')
            .eq('contact_id', contactRecord.id)
            .maybeSingle();

          if (latestProp) {
            propSession = latestProp;
            console.log(`[chatbot-engine] Concurrently created property session resolved after ${pollCount * 500}ms`);
          }
          if (latestContact) {
            contactSession = latestContact;
            console.log(`[chatbot-engine] Concurrently created contact session resolved after ${pollCount * 500}ms`);
          }
          pollCount++;
        }
      }
    } catch (err) {
      console.error('[chatbot-engine] Error in concurrency session lookup:', err);
    }
  }

  // 1.5. Session Expiry Timeout (15 minutes of inactivity)
  const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  const now = Date.now();

  if (propSession) {
    const updatedAt = new Date(propSession.updated_at).getTime();
    if (now - updatedAt > SESSION_TIMEOUT_MS) {
      console.log(`[chatbot-engine] Expiring inactive property draft session ${propSession.id}`);
      await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
      propSession = null;
    }
  }

  if (contactSession) {
    const updatedAt = new Date(contactSession.updated_at).getTime();
    if (now - updatedAt > SESSION_TIMEOUT_MS) {
      console.log(`[chatbot-engine] Expiring inactive contact draft session ${contactSession.id}`);
      await supabaseAdmin().from('contact_draft_sessions').delete().eq('id', contactSession.id);
      contactSession = null;
    }
  }

  // Lazily download the inbound media (image/doc) at most once, caching
  // the buffer so the task-switch classifier, the contact-merge branch,
  // and the new-session parser can all reuse it without re-fetching.
  let inboundMediaBuffer: Buffer | undefined;
  let inboundMediaMime: string | undefined;
  let inboundMediaFetched = false;
  async function loadInboundMedia(): Promise<{ buffer?: Buffer; mimeType?: string }> {
    if (inboundMediaFetched) return { buffer: inboundMediaBuffer, mimeType: inboundMediaMime };
    inboundMediaFetched = true;
    if (isImageMsg || isDocMsg) {
      const mediaId = isImageMsg ? message.image!.id : message.document!.id;
      const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
      inboundMediaBuffer = buffer;
      inboundMediaMime = mimeType;
    }
    return { buffer: inboundMediaBuffer, mimeType: inboundMediaMime };
  }

  // 1.8. Quick Task Switch / Fresh Ingestion Intercept
  const hasContactKeywords = cleanedText && (
    /is interested in|referred by|magicbricks|99acres|housing\.com/i.test(cleanedText) ||
    (cleanedText.split('\n').length >= 2 && /\b\d{10,15}\b/.test(cleanedText))
  );

  if (propSession && hasContactKeywords) {
    if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
      return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
    }
    const classification = await classifyImageOrText(cleanedText, undefined, undefined);
    if (classification === 'contact') {
      console.log(`[chatbot-engine] Discarding active property session ${propSession.id} to start contact flow`);
      await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
      propSession = null;
    }
  }

  if (contactSession && isImageMsg) {
    // An image during an active contact draft is ambiguous: it may be a
    // property listing (task switch) OR additional contact/requirements
    // to merge into the current draft. Classify before abandoning the
    // draft — only a genuine property discards the contact session; a
    // contact screenshot is left for the merge branch below to enrich.
    if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
      return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
    }
    try {
      const { buffer, mimeType } = await loadInboundMedia();
      const imgClass = await classifyImageOrText(cleanedText, buffer, mimeType);
      if (imgClass === 'property') {
        console.log(`[chatbot-engine] Discarding active contact session ${contactSession.id} to start property flow`);
        await supabaseAdmin().from('contact_draft_sessions').delete().eq('id', contactSession.id);
        contactSession = null;
      }
    } catch (err) {
      // On a classify/download failure, keep the contact session so the
      // image is treated as enrichment rather than silently lost.
      console.error('[chatbot-engine] Error classifying image during active contact session:', err);
    }
  } else if (contactSession && cleanedText) {
    const isNewContactForward = /is interested in|referred by|magicbricks|99acres|housing\.com/i.test(cleanedText);
    const isPropertyListing = /\b(bhk|sqft|flat|plot|villa|crore|lakh|price)\b/i.test(cleanedText) && cleanedText.length > 50;
    
    if (isNewContactForward || isPropertyListing) {
      if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const classification = await classifyImageOrText(cleanedText, undefined, undefined);
      if (classification === 'property') {
        console.log(`[chatbot-engine] Discarding active contact session ${contactSession.id} to start property flow`);
        await supabaseAdmin().from('contact_draft_sessions').delete().eq('id', contactSession.id);
        contactSession = null;
      } else if (classification === 'contact' && isNewContactForward) {
        console.log(`[chatbot-engine] Discarding old contact session ${contactSession.id} to start fresh contact flow`);
        await supabaseAdmin().from('contact_draft_sessions').delete().eq('id', contactSession.id);
        contactSession = null;
      }
    }
  }

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
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    // Handle CONFIRM instruction
    if (buttonId === 'confirm_property' || lowerText === 'confirm') {
      const { isValid, missingFields } = validateDraft(draft);
      if (!isValid) {
        const reply = `⚠️ *Cannot confirm yet.* The following mandatory fields are missing:\n\n` +
          missingFields.map(f => `• *${f}*`).join('\n') +
          `\n\nPlease provide them first (e.g. 'price is 1.5 Cr', 'title is HSR 3BHK Apartment').`;
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      let ownerContactId = null;
      let listingSource = 'owner';
      let extraNotesFromOwner = null;

      if (draft.owner_contact_name) {
        const ownerName = draft.owner_contact_name.trim();
        const ownerPhone = draft.owner_contact_phone;
        const normalizedPhone = ownerPhone ? (normalizePhoneWithCountryCode(ownerPhone, '91') || null) : null;

        if (normalizedPhone) {
          const cleanPhone = normalizedPhone.replace(/\D/g, '');
          const { data: existingContacts } = await supabaseAdmin()
            .from('contacts')
            .select('id, name, classification')
            .eq('account_id', accountId)
            .or(`phone.eq.${ownerPhone},phone.eq.${normalizedPhone},phone.eq.${cleanPhone}`);

          if (existingContacts && existingContacts.length > 0) {
            const contact = existingContacts[0];
            ownerContactId = contact.id;
            if (contact.classification === 'Agent') {
              listingSource = 'agent';
            } else {
              listingSource = 'owner';
            }
          } else {
            // Contact not found -> Create a new contact with phone number
            const newClassification = draft.owner_contact_role === 'Agent' ? 'Agent' : 'Owner';
            const { data: newContact, error: createErr } = await supabaseAdmin()
              .from('contacts')
              .insert({
                account_id: accountId,
                user_id: userId,
                name: ownerName,
                phone: normalizedPhone,
                classification: newClassification,
                status: 'pending_review',
                source: 'WhatsApp'
              })
              .select()
              .single();

            if (!createErr && newContact) {
              ownerContactId = newContact.id;
              listingSource = newClassification === 'Agent' ? 'agent' : 'owner';
            } else {
              console.error('[chatbot-engine] Error creating new contact for listing owner:', createErr);
            }
          }
        } else {
          // No phone number provided -> Save owner details to internal notes field of the property
          const roleLabel = draft.owner_contact_role === 'Agent' ? 'Agent' : 'Owner';
          extraNotesFromOwner = `Owner Details: ${ownerName} (${roleLabel}, No contact number provided)`;
        }
      }

      const parsedRent = parseNumeric(draft.rent_per_month) || 0;
      const parsedPriceVal = parseNumeric(draft.price) || 0;

      // Create new property in inventory
      const { data: prop, error: propErr } = await supabaseAdmin()
        .from('properties')
        .insert({
          account_id: accountId,
          user_id: userId,
          title: draft.title!.trim(),
          description: draft.description || '',
          price: draft.listing_type === 'Rent' ? parsedRent : parsedPriceVal,
          location: draft.location!.trim(),
          type: draft.type || 'Others',
          status: 'Available',
          bedrooms: parseNumeric(draft.bedrooms),
          bathrooms: parseNumeric(draft.bathrooms),
          area_sqft: parseNumeric(draft.area_sqft),
          sublocality: draft.sublocality,
          city: draft.city || 'Bangalore',
          state: draft.state || 'Karnataka',
          dimensions: draft.dimensions,
          facing_direction: draft.facing_direction,
          is_published: true,
          features: draft.features || [],
          nearby_highlights: draft.nearby_highlights || [],
          images: draft.images || [],
          rental_income: parseNumeric(draft.rental_income),
          roi: parseNumeric(draft.roi),
          google_map_link: draft.google_map_link,
          land_area: parseNumeric(draft.land_area),
          land_area_unit: draft.land_area_unit || 'Sq.Ft.',
          land_zone: (() => {
            if (!draft.type) return null;
            const typeLower = draft.type.toLowerCase();
            if (typeLower.includes('industrial') || typeLower.includes('shed')) {
              return 'Industrial';
            }
            if (typeLower.includes('sez')) {
              return 'SEZ';
            }
            if (typeLower.includes('agricultural') || typeLower.includes('farm')) {
              return 'Agricultural';
            }
            if (
              typeLower.includes('commercial') ||
              typeLower.includes('office') ||
              typeLower.includes('warehouse') ||
              typeLower.includes('godown') ||
              typeLower.includes('shop') ||
              typeLower.includes('showroom') ||
              typeLower.includes('it park')
            ) {
              return 'Commercial';
            }
            if (
              typeLower.includes('residential') ||
              typeLower.includes('flat') ||
              typeLower.includes('apartment') ||
              typeLower.includes('house') ||
              typeLower.includes('villa') ||
              typeLower.includes('floor')
            ) {
              return 'Residential';
            }
            return null;
          })(),
          owner_contact_id: ownerContactId,
          listing_source: listingSource,
          listing_type: draft.listing_type || 'Sale',
          rent_per_month: parseNumeric(draft.rent_per_month),
          maintenance: parseNumeric(draft.maintenance),
          advance: parseNumeric(draft.advance),
          gst: parseNumeric(draft.gst),
          notes: [
            `Ingested automatically via WhatsApp chatbot.`,
            extraNotesFromOwner
          ].filter(Boolean).join('\n')
        })
        .select()
        .single();

      if (propErr) {
        console.error('[chatbot-engine] Failed to save property:', propErr);
        const reply = "❌ *Error saving property to database.* Please try again later.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      // Delete active draft session
      await supabaseAdmin()
        .from('property_draft_sessions')
        .delete()
        .eq('id', propSession.id);

      if (prop && prop.id) {
        autoSyncPropertyCatalogIfNeeded(supabaseAdmin(), prop.id, accountId).catch((err) => {
          console.error('[chatbot-engine] Auto-sync background error:', err);
        });
        // Match Radar: surface matching buyers for the just-ingested
        // listing (fire-and-forget — must never delay the WhatsApp reply).
        import('@/lib/radar/engine')
          .then(({ generateMatchEventForProperty }) =>
            generateMatchEventForProperty(supabaseAdmin(), accountId, prop.id)
          )
          .catch((err) => {
            console.error('[chatbot-engine] Radar background error:', err);
          });
      }

      let reply = `✅ *Property listing created successfully!*\n\n` +
        `*Code:* ${prop.property_code}\n` +
        `*Title:* ${prop.title}\n` +
        `*Price:* ₹${prop.price.toLocaleString('en-IN')}\n` +
        `*Location:* ${prop.location}\n` +
        `*Type:* ${prop.type}\n` +
        (prop.land_area ? `*Land Area:* ${prop.land_area} ${prop.land_area_unit || 'Sq.Ft.'}\n` : '');

      if (prop.rental_income) {
        reply += `*Rent:* ₹${prop.rental_income.toLocaleString('en-IN')}/month\n`;
      }
      if (prop.roi) {
        reply += `*ROI (Yield):* ${prop.roi}%\n`;
      }
      if (prop.features && prop.features.length > 0) {
        reply += `*Amenities:* ${prop.features.join(', ')}\n`;
      }
      if (prop.nearby_highlights && prop.nearby_highlights.length > 0) {
        reply += `*Nearby Highlights:* ${prop.nearby_highlights.join(', ')}\n`;
      }
      if (ownerContactId && draft.owner_contact_name) {
        reply += `*Source Referrer/Owner:* ${draft.owner_contact_name} [Mapped as ${listingSource.toUpperCase()}]\n`;
      }

      reply += `\nView it in your dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/inventory?propertyId=${prop.id}`;
        
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    // Handle image upload inside active session
    if (message.type === 'image' && message.image?.id) {
      // Prompt user that we are downloading/uploading
      const uploadMsg = "⏳ _Uploading photo to draft listing... Please wait._";
      const uploadSendRes = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: uploadMsg
      });
      await saveBotMessage(conversation.id, uploadMsg, uploadSendRes.messageId);

      try {
        const mediaId = message.image.id;
        const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
        const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
        
        const publicUrl = await uploadPropertyImage(accountId, buffer, mimeType);
        
        let updatedDraft = draft;
        let nextStatus = propSession.status;
        let success = false;
        let retryCount = 0;
        const maxRetries = 5;
        let finalUpdateData: { updated_at: string }[] | null = null;

        while (retryCount < maxRetries && !success) {
          const { data: latestSession, error: fetchErr } = await supabaseAdmin()
            .from('property_draft_sessions')
            .select('*')
            .eq('id', propSession.id)
            .single();

          if (fetchErr || !latestSession) {
            if (fetchErr?.code === 'PGRST116') {
              console.log('[chatbot-engine] Active session was deleted concurrently. Exiting photo upload flow.');
              return true;
            }
            throw fetchErr || new Error('Session not found during image append retry');
          }

          const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
          const currentImages = currentDraft.images || [];
          const updatedImages = currentImages.includes(publicUrl)
            ? currentImages
            : [...currentImages, publicUrl];
          
          updatedDraft = { ...currentDraft, images: updatedImages };
          
          const validation = validateDraft(updatedDraft);
          nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';

          const { data: updateData, error: updateErr } = await supabaseAdmin()
            .from('property_draft_sessions')
            .update({
              draft_data: updatedDraft,
              status: nextStatus,
              updated_at: new Date().toISOString()
            })
            .eq('id', propSession.id)
            .eq('updated_at', latestSession.updated_at)
            .select();

          if (!updateErr && updateData && updateData.length > 0) {
            success = true;
            finalUpdateData = updateData;
          } else {
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));
          }
        }

        if (!success || !finalUpdateData || finalUpdateData.length === 0) {
          throw new Error('Failed to update draft session due to concurrent modifications');
        }

        const savedTime = finalUpdateData[0].updated_at;

        sendPropertyDraftPreviewDebounced(
          propSession.id,
          savedTime,
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📸 *Photo added successfully!* Total photos attached: *${updatedDraft.images.length}*.`,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error processing photo upload:', err);
        const reply = "❌ *Failed to upload image.* Please verify the photo format and try again.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }
    }

    // Handle conversational update/correction text.
    //
    // Re-fetches + retries with an optimistic-lock precondition (same
    // pattern as the image-upload branch above) instead of blindly
    // overwriting `draft_data` from the snapshot read at the top of
    // this call. Without it, two corrections landing close together
    // (e.g. "Location - X" then "Type - Y") each build on the SAME
    // stale base and the second write silently clobbers the first —
    // a field the user just provided reverts to "Missing".
    if (cleanedText) {
      let updatedDraft = draft;
      let nextStatus: string = propSession.status;
      let success = false;
      let retryCount = 0;
      const maxRetries = 5;
      let finalUpdateData: { updated_at: string }[] | null = null;

      // Burn once, before the optimistic-lock retry loop — retries
      // re-run the AI merge but must not re-charge the account.
      if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }

      while (retryCount < maxRetries && !success) {
        const { data: latestSession, error: fetchErr } = await supabaseAdmin()
          .from('property_draft_sessions')
          .select('*')
          .eq('id', propSession.id)
          .single();

        if (fetchErr || !latestSession) {
          if (fetchErr?.code === 'PGRST116') {
            console.log('[chatbot-engine] Active session was deleted concurrently. Exiting text update flow.');
            return true;
          }
          throw fetchErr || new Error('Session not found during text update retry');
        }

        const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
        updatedDraft = await updateListingDraft(currentDraft, cleanedText);
        updatedDraft = await backfillLocationFromMapLink(updatedDraft);

        const validation = validateDraft(updatedDraft);
        nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';

        const { data: updateData, error: updateErr } = await supabaseAdmin()
          .from('property_draft_sessions')
          .update({
            draft_data: updatedDraft,
            status: nextStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', propSession.id)
          .eq('updated_at', latestSession.updated_at)
          .select();

        if (!updateErr && updateData && updateData.length > 0) {
          success = true;
          finalUpdateData = updateData;
        } else {
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));
        }
      }

      if (!success || !finalUpdateData || finalUpdateData.length === 0) {
        const reply = "⚠️ *Couldn't save your update due to a conflicting change.* Please resend it.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      const actualSavedTime = finalUpdateData[0].updated_at;

      sendPropertyDraftPreviewDebounced(
        propSession.id,
        actualSavedTime,
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📝 *Draft Listing Updated:*`,
        conversation.id
      );
      return true;
    }

    return true;
  }

  // 3. Active Contact Session Exists Flow
  if (contactSession) {
    const container = contactSession.draft_data as ParsedContactDraftsContainer;

    // Handle CANCEL instruction
    if (buttonId === 'cancel_contact' || lowerText === 'cancel') {
      await supabaseAdmin()
        .from('contact_draft_sessions')
        .delete()
        .eq('id', contactSession.id);

      const reply = "❌ *Contact drafts discarded.* Send another contact text details or screenshot to start a new contact draft.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    // Handle CONFIRM instruction
    if (buttonId === 'confirm_contact' || lowerText === 'confirm') {
      const { isValid, missingFields } = validateContactDraftsContainer(container);
      if (!isValid) {
        const reply = `⚠️ *Cannot confirm yet.* The following fields are missing:\n\n` +
          missingFields.map(f => `• *${f}*`).join('\n') +
          `\n\nPlease provide them first.`;
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      // Fetch all published properties to do auto-matching
      const { data: properties } = await supabaseAdmin()
        .from('properties')
        .select('id, title, property_code, project')
        .eq('account_id', accountId)
        .eq('is_published', true);

      const matchedPropertyMap = new Map<string, { id: string; title: string; property_code?: string | null; project?: string | null }>();

      // Check duplicates and save new contacts in bulk
      const toInsert = [];
      const duplicates = [];

      for (const draft of container.contacts) {
        const normalized = normalizePhoneWithCountryCode(draft.phone || '', '91');
        const cleanPhone = normalized.replace(/\D/g, '');
        const { data: existingContact } = await supabaseAdmin()
          .from('contacts')
          .select('id, name')
          .eq('account_id', accountId)
          .or(`phone.eq.${draft.phone},phone.eq.${normalized},phone.eq.${cleanPhone}`)
          .maybeSingle();

        if (existingContact) {
          duplicates.push(`${existingContact.name} (${normalized || draft.phone})`);
        } else {
          // Resolve referrer if present
          let referrerContactId = null;
          let referrerNameText = draft.referrer_name || null;

          if (draft.referrer_name) {
            const refName = draft.referrer_name.trim();
            const refPhone = draft.referrer_phone;
            let refQuery = supabaseAdmin().from('contacts').select('id, name').eq('account_id', accountId);
            
            if (refPhone) {
              const refNormalized = normalizePhoneWithCountryCode(refPhone, '91');
              const refCleanPhone = refNormalized.replace(/\D/g, '');
              const escapedRefName = refName.replace(/"/g, '\\"');
              refQuery = refQuery.or(`phone.eq.${refPhone},phone.eq.${refNormalized},phone.eq.${refCleanPhone},name.ilike."${escapedRefName}"`);
            } else {
              refQuery = refQuery.ilike('name', refName);
            }

            const { data: existingRefs } = await refQuery;
            if (existingRefs && existingRefs.length > 0) {
              referrerContactId = existingRefs[0].id;
              referrerNameText = existingRefs[0].name;
            }
          }

          let lastInquiredPropertyId = null;
          if (properties && draft.notes) {
            const notesLower = draft.notes.toLowerCase();
            const matchedProp = properties.find((p: { id: string; title: string; property_code?: string | null; project?: string | null }) => {
              // 1. Code match (e.g. PROP-1002)
              if (p.property_code && notesLower.includes(p.property_code.toLowerCase())) {
                return true;
              }

              // 2. Title match
              if (notesLower.includes(p.title.toLowerCase())) {
                return true;
              }

              // 3. Full project match (minimum 3 characters)
              if (p.project && p.project.trim().length >= 3) {
                const proj = p.project.trim().toLowerCase();
                if (notesLower.includes(proj)) return true;
              }

              // 4. First 2 words of project match (e.g. "SJR Blue" for "SJR Blue Waters")
              if (p.project) {
                const projectWords = p.project.trim().toLowerCase().split(/\s+/);
                if (projectWords.length >= 2) {
                  const firstTwoWords = projectWords.slice(0, 2).join(' ');
                  if (firstTwoWords.length >= 5 && notesLower.includes(firstTwoWords)) {
                    return true;
                  }
                }
              }

              // 5. Cleaned title keywords match (ignores prepositions and common specifiers)
              const stopWords = new Set(['in', 'at', 'to', 'on', 'of', 'a', 'an', 'the', 'with', 'by', 'for', 'and', 'or', 'is', 'are', 'am', 'was', 'were']);
              const cleanTitle = p.title
                .toLowerCase()
                .replace(/(?:\d+\s*(?:bhk|bedroom|bath|bathroom)|apartment|villa|plot|house|for\s+sale|for\s+rent|luxurious|luxury|beautiful|spacious|rent|sale)/gi, ' ')
                .replace(/[^\w\s]/g, ' ')
                .trim();
              
              const cleanWords = cleanTitle.split(/\s+/).filter((w: string) => w.length > 1 && !stopWords.has(w));
              if (cleanWords.length >= 2) {
                const phrase2 = cleanWords.slice(0, 2).join(' ');
                if (phrase2.length >= 6 && notesLower.includes(phrase2)) {
                  return true;
                }
                if (cleanWords.length >= 3) {
                  const phrase3 = cleanWords.slice(0, 3).join(' ');
                  if (phrase3.length >= 8 && notesLower.includes(phrase3)) {
                    return true;
                  }
                }
              }

              // 6. Fallback project keywords from title
              const projectKeywords = p.title.replace(/(?:\d+\s*(?:BHK|bhk)|apartment|villa|plot|house|for\s+sale|for\s+rent)/gi, '').trim();
              if (projectKeywords.length > 5 && notesLower.includes(projectKeywords.toLowerCase())) {
                return true;
              }

              return false;
            });
            if (matchedProp) {
              lastInquiredPropertyId = matchedProp.id;
              matchedPropertyMap.set(normalized || draft.phone!.trim(), matchedProp);
            }
          }

          toInsert.push({
            account_id: accountId,
            user_id: userId,
            name: draft.name!.trim(),
            phone: normalized || draft.phone!.trim(),
            email: draft.email || null,
            company: draft.company || '',
            classification: normalizeClassification(draft.classification),
            status: 'pending_review',
            source: 'WhatsApp',
            requirements: draft.requirements || null,
            _notes: draft.notes || null, // temporary field, stripped before DB insert
            referrer: referrerNameText,
            referrer_contact_id: referrerContactId,
            last_inquired_property_id: lastInquiredPropertyId
          });
        }
      }

      if (toInsert.length === 0) {
        const reply = `⚠️ *All contacts already exist in CRM:* \n` + 
          duplicates.map(d => `• ${d}`).join('\n') + 
          `\n\nContact draft session discarded.`;
        await supabaseAdmin()
          .from('contact_draft_sessions')
          .delete()
          .eq('id', contactSession.id);
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      // Strip the temporary _notes field before DB insert
      const notesMap: Record<string, string | null> = {};
      const contactsToInsert = toInsert.map((c: Record<string, unknown>) => {
        const { _notes, ...rest } = c;
        notesMap[rest.phone as string] = _notes as string | null;
        return rest;
      });

      // Create new contacts in CRM
      const { data: inserted, error: contactErr } = await supabaseAdmin()
        .from('contacts')
        .insert(contactsToInsert)
        .select();

      if (contactErr) {
        console.error('[chatbot-engine] Failed to save contacts:', contactErr);
        const reply = "❌ *Error saving contacts to database.* Please try again later.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      // Auto-tag inserted contacts with matched property/project tags
      if (inserted && inserted.length > 0) {
        try {
          const { data: existingTags } = await supabaseAdmin()
            .from('tags')
            .select('id, name')
            .eq('account_id', accountId);

          const tagsCache = new Map<string, string>();
          if (existingTags) {
            existingTags.forEach((t: { id: string; name: string }) => tagsCache.set(t.name.toLowerCase(), t.id));
          }

          const tagColors = ['#0EA5E9', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#6366F1', '#EF4444', '#14B8A6'];
          const tagLinksToInsert = [];

          for (const contact of inserted) {
            const matchedProp = matchedPropertyMap.get(contact.phone);
            if (matchedProp) {
              let tagName = '';
              if (matchedProp.project && matchedProp.project.trim().length >= 3) {
                tagName = matchedProp.project.trim();
              } else if (matchedProp.property_code) {
                tagName = matchedProp.property_code.trim();
              } else {
                tagName = matchedProp.title.replace(/(?:\d+\s*(?:BHK|bhk)|apartment|villa|plot|house|for\s+sale|for\s+rent)/gi, '').trim();
                if (tagName.length > 20) {
                  tagName = tagName.substring(0, 20) + '...';
                }
              }

              if (tagName) {
                const lowerName = tagName.toLowerCase();
                let tagId = tagsCache.get(lowerName);

                if (!tagId) {
                  const randomColor = tagColors[Math.floor(Math.random() * tagColors.length)];
                  const { data: newTag, error: createTagErr } = await supabaseAdmin()
                    .from('tags')
                    .insert({
                      account_id: accountId,
                      user_id: userId,
                      name: tagName,
                      color: randomColor
                    })
                    .select()
                    .single();

                  if (!createTagErr && newTag) {
                    tagId = newTag.id;
                    tagsCache.set(lowerName, newTag.id);
                  } else {
                    console.error('[chatbot-engine] Failed to create tag for property:', createTagErr);
                  }
                }

                if (tagId) {
                  tagLinksToInsert.push({
                    contact_id: contact.id,
                    tag_id: tagId
                  });
                }
              }
            }
          }

          if (tagLinksToInsert.length > 0) {
            const { error: linkTagErr } = await supabaseAdmin()
              .from('contact_tags')
              .insert(tagLinksToInsert);

            if (linkTagErr) {
              console.error('[chatbot-engine] Failed to link tags to contacts:', linkTagErr);
            }
          }
        } catch (tagErr) {
          console.error('[chatbot-engine] Exception in auto-tagging contacts:', tagErr);
        }
      }

      // Save notes as contact_notes rows for contacts that have notes
      const noteRows = inserted
        .filter((c: Contact) => notesMap[c.phone])
        .map((c: Contact) => ({
          contact_id: c.id,
          user_id: userId,
          account_id: accountId,
          note_text: notesMap[c.phone]!.trim(),
        }));

      if (noteRows.length > 0) {
        const { error: noteErr } = await supabaseAdmin()
          .from('contact_notes')
          .insert(noteRows);
        if (noteErr) {
          console.error('[chatbot-engine] Failed to save contact notes:', noteErr);
        }
      }

      // Delete contact draft session
      await supabaseAdmin()
        .from('contact_draft_sessions')
        .delete()
        .eq('id', contactSession.id);

      let reply = `✅ *Successfully saved ${inserted.length} new contact(s) to CRM!*\n\n`;
      inserted.forEach((c: Contact) => {
        reply += `• *Name:* ${c.name} (${c.phone}) [${c.classification}]\n`;
      });
      if (duplicates.length > 0) {
        reply += `\n⚠️ *Skipped duplicates:* \n` + duplicates.map(d => `• ${d}`).join('\n') + `\n`;
      }
      if (inserted.length === 1) {
        reply += `\nView in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts?contactId=${inserted[0].id}`;
      } else {
        reply += `\nView in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts`;
      }
        
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }


    // Handle an ADDITIONAL screenshot/document sent during an active
    // contact draft — parse it and MERGE into the current draft (backfill
    // missing fields, concatenate notes/requirements) instead of dropping
    // it or spawning a fresh draft with a blank name/phone.
    if (isMediaMsg) {
      if (!(await gatedBurn(accountId, 'contact_parse'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const analyzingMsg = "⏳ _Analyzing extra details... Please wait._";
      const analyzingRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: analyzingMsg });
      await saveBotMessage(conversation.id, analyzingMsg, analyzingRes.messageId);

      try {
        const { buffer, mimeType } = await loadInboundMedia();
        const parsedIncoming = await parseContactFromImageOrText(contentText || '', buffer, mimeType);
        const mergedContainer = mergeContactDraftsContainer(container, parsedIncoming);
        const { isValid, missingFields } = validateContactDraftsContainer(mergedContainer);
        const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        await supabaseAdmin()
          .from('contact_draft_sessions')
          .update({
            draft_data: mergedContainer,
            status: nextStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', contactSession.id);

        await sendContactDraftPreview(
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📝 *Contact Drafts Updated:*`,
          mergedContainer,
          nextStatus,
          missingFields,
          conversation.id,
          accountId
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error merging additional contact media into draft:', err);
        const reply = "❌ *Couldn't read that screenshot.* Your current draft is unchanged — reply with details as text, or use Confirm/Cancel.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }
    }

    // Handle conversational updates to contact drafts
    if (cleanedText) {
      if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const updatedContainer = await updateContactDraft(container, cleanedText);
      const { isValid, missingFields } = validateContactDraftsContainer(updatedContainer);
      const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

      await supabaseAdmin()
        .from('contact_draft_sessions')
        .update({
          draft_data: updatedContainer,
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactSession.id);

      await sendContactDraftPreview(
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📝 *Contact Drafts Updated:*`,
        updatedContainer,
        nextStatus,
        missingFields,
        conversation.id,
        accountId
      );
      return true;
    }

    return true;
  }

  // 4. Start New Session Flow (No Session Exists)
  if (isMediaMsg || cleanedText) {
    const { buffer: mediaBuffer, mimeType: mediaMimeType } = await loadInboundMedia();

    if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
      return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
    }
    const classification = await classifyImageOrText(cleanedText, mediaBuffer, mediaMimeType);

    // --- PROPERTY INGESTION FLOW ---
    if (classification === 'property') {
      // Gate the parse burn before announcing "Analyzing…" so a
      // drained balance produces the lock reply, not a dead promise.
      if (!(await gatedBurn(accountId, 'listing_parse'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const analyzingMsg = "⏳ _Analyzing listing details... Please wait._";
      const analyzingSendRes = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: analyzingMsg
      });
      await saveBotMessage(conversation.id, analyzingMsg, analyzingSendRes.messageId);

      try {
        let parsedDraft: ParsedPropertyDraft;
        const uploadedImages: string[] = [];

        if (isMediaMsg && mediaBuffer && mediaMimeType) {
          if (isImageMsg) {
            // Parallel parse and upload to save latency
            const [parsed, publicUrl] = await Promise.all([
              parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType),
              uploadPropertyImage(accountId, mediaBuffer, mediaMimeType)
            ]);

            parsedDraft = parsed;
            uploadedImages.push(publicUrl);
            parsedDraft.images = uploadedImages;
          } else if (mediaMimeType === 'application/pdf') {
            // Parallel parse text details and extract images
            const [parsed, extractedImgBuffers] = await Promise.all([
              parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType),
              extractImagesFromPdf(mediaBuffer)
            ]);

            parsedDraft = parsed;

            // Limit and upload extracted images
            if (extractedImgBuffers.length > 0) {
              const maxImages = 15;
              const imagesToUpload = extractedImgBuffers.slice(0, maxImages);
              console.log(`[chatbot-engine] Extracted ${extractedImgBuffers.length} images from PDF. Uploading top ${imagesToUpload.length} to storage...`);

              const uploadPromises = imagesToUpload.map(buf =>
                uploadPropertyImage(accountId, buf, 'image/jpeg')
                  .catch(err => {
                    console.error('[chatbot-engine] Image upload from PDF failed:', err);
                    return null;
                  })
              );

              const urls = await Promise.all(uploadPromises);
              const validUrls = urls.filter((url): url is string => url !== null);
              uploadedImages.push(...validUrls);
              parsedDraft.images = uploadedImages;
            } else {
              parsedDraft.images = [];
            }
          } else {
            // Other document types fallback
            parsedDraft = await parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType);
            parsedDraft.images = [];
          }
        } else {
          parsedDraft = await parseListingFromImageOrText(cleanedText);
          parsedDraft.images = [];
        }

        parsedDraft = await backfillLocationFromMapLink(parsedDraft);

        const { isValid } = validateDraft(parsedDraft);
        const initialStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        // Insert new active session
        const { data: insertedData, error: insertErr } = await supabaseAdmin()
          .from('property_draft_sessions')
          .insert({
            account_id: accountId,
            contact_id: contactRecord.id,
            draft_data: parsedDraft,
            status: initialStatus
          })
          .select();

        if (insertErr) {
          // If a concurrent thread created the session first, fall back to merging or appending
          if (insertErr.code === '23505') {
            console.log('[chatbot-engine] Session already initialized by concurrent request. Falling back to merge/append flow.');
            const { data: existingSession } = await supabaseAdmin()
              .from('property_draft_sessions')
              .select('*')
              .eq('contact_id', contactRecord.id)
              .maybeSingle();

            if (existingSession) {
              const currentDraft = existingSession.draft_data as ParsedPropertyDraft;

              // 1. Check if it is a duplicate of the same ingestion (e.g. duplicate webhook retry)
              const isDuplicate = 
                (parsedDraft.title && currentDraft.title === parsedDraft.title) ||
                (parsedDraft.location && currentDraft.location === parsedDraft.location) ||
                (parsedDraft.images && parsedDraft.images.length > 0 && currentDraft.images && currentDraft.images.some((img: string) => parsedDraft.images.includes(img)));

              if (isDuplicate) {
                console.log('[chatbot-engine] Duplicate ingestion detected concurrently. Exiting duplicate thread silently.');
                return true;
              }

              // 2. Otherwise, merge the newly parsed details/images into the existing fresh session
              let success = false;
              let retryCount = 0;
              const maxRetries = 5;
              let mergedDraft = currentDraft;
              let nextStatus = existingSession.status;
              let finalUpdateData: { updated_at: string }[] | null = null;

              while (retryCount < maxRetries && !success) {
                const { data: latestSession } = await supabaseAdmin()
                  .from('property_draft_sessions')
                  .select('*')
                  .eq('id', existingSession.id)
                  .single();

                if (latestSession) {
                  const latestDraft = latestSession.draft_data as ParsedPropertyDraft;
                  
                  mergedDraft = {
                    title: latestDraft.title || parsedDraft.title,
                    description: latestDraft.description || parsedDraft.description,
                    price: latestDraft.price || parsedDraft.price,
                    location: latestDraft.location || parsedDraft.location,
                    type: latestDraft.type || parsedDraft.type,
                    bedrooms: latestDraft.bedrooms || parsedDraft.bedrooms,
                    bathrooms: latestDraft.bathrooms || parsedDraft.bathrooms,
                    area_sqft: latestDraft.area_sqft || parsedDraft.area_sqft,
                    sublocality: latestDraft.sublocality || parsedDraft.sublocality,
                    city: latestDraft.city || parsedDraft.city,
                    state: latestDraft.state || parsedDraft.state,
                    dimensions: latestDraft.dimensions || parsedDraft.dimensions,
                    facing_direction: latestDraft.facing_direction || parsedDraft.facing_direction,
                    google_map_link: latestDraft.google_map_link || parsedDraft.google_map_link,
                    land_area: latestDraft.land_area || parsedDraft.land_area,
                    land_area_unit: latestDraft.land_area_unit || parsedDraft.land_area_unit,
                    rental_income: latestDraft.rental_income || parsedDraft.rental_income,
                    roi: latestDraft.roi || parsedDraft.roi,
                    owner_contact_name: latestDraft.owner_contact_name || parsedDraft.owner_contact_name,
                    owner_contact_phone: latestDraft.owner_contact_phone || parsedDraft.owner_contact_phone,
                    owner_contact_role: latestDraft.owner_contact_role || parsedDraft.owner_contact_role,
                    listing_type: latestDraft.listing_type || parsedDraft.listing_type,
                    rent_per_month: latestDraft.rent_per_month || parsedDraft.rent_per_month,
                    maintenance: latestDraft.maintenance || parsedDraft.maintenance,
                    advance: latestDraft.advance || parsedDraft.advance,
                    gst: latestDraft.gst || parsedDraft.gst,
                    features: Array.from(new Set([...(latestDraft.features || []), ...(parsedDraft.features || [])])),
                    nearby_highlights: Array.from(new Set([...(latestDraft.nearby_highlights || []), ...(parsedDraft.nearby_highlights || [])])),
                    images: Array.from(new Set([...(latestDraft.images || []), ...(parsedDraft.images || [])]))
                  };

                  const validation = validateDraft(mergedDraft);
                  nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';

                  const { data: updateData, error: updateErr } = await supabaseAdmin()
                    .from('property_draft_sessions')
                    .update({
                      draft_data: mergedDraft,
                      status: nextStatus,
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', existingSession.id)
                    .eq('updated_at', latestSession.updated_at)
                    .select();

                  if (!updateErr && updateData && updateData.length > 0) {
                    success = true;
                    finalUpdateData = updateData;
                  } else {
                    retryCount++;
                    await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));
                  }
                } else {
                  retryCount++;
                }
              }

              if (success && finalUpdateData && finalUpdateData.length > 0) {
                const savedTime = finalUpdateData[0].updated_at;
                sendPropertyDraftPreviewDebounced(
                  existingSession.id,
                  savedTime,
                  phoneNumberId,
                  accessToken,
                  contactRecord.phone,
                  `📝 *Listing details and photos merged into draft!*`,
                  conversation.id
                );
                return true;
              }
            }
          }
          throw insertErr;
        }

        if (!insertErr && insertedData && insertedData.length > 0) {
          const savedTime = insertedData[0].updated_at;
          sendPropertyDraftPreviewDebounced(
            insertedData[0].id,
            savedTime,
            phoneNumberId,
            accessToken,
            contactRecord.phone,
            `📝 *Draft Property Listing Created!*`,
            conversation.id
          );
        }
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error initializing property draft session:', err);
        const reply = "❌ *Failed to parse listing.* Please copy paste details as text or send a clean property advertisement image.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }
    }

    // --- CONTACT INGESTION FLOW ---
    if (classification === 'contact') {
      // Gate the parse burn before announcing "Analyzing…" so a
      // drained balance produces the lock reply, not a dead promise.
      if (!(await gatedBurn(accountId, 'contact_parse'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const analyzingContactMsg = "⏳ _Analyzing contact details... Please wait._";
      const analyzingContactSendRes = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: analyzingContactMsg
      });
      await saveBotMessage(conversation.id, analyzingContactMsg, analyzingContactSendRes.messageId);

      try {
        let parsedContainer: ParsedContactDraftsContainer;

        if (isMediaMsg && mediaBuffer && mediaMimeType) {
          parsedContainer = await parseContactFromImageOrText(contentText || '', mediaBuffer, mediaMimeType);
        } else {
          parsedContainer = await parseContactFromImageOrText(cleanedText);
        }

        const { isValid, missingFields } = validateContactDraftsContainer(parsedContainer);
        const initialStatus = isValid ? 'awaiting_confirmation' : 'collecting';

        // Insert new active session
        await supabaseAdmin()
          .from('contact_draft_sessions')
          .insert({
            account_id: accountId,
            contact_id: contactRecord.id,
            draft_data: parsedContainer,
            status: initialStatus
          });

        await sendContactDraftPreview(
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📝 *Contact Drafts Created!*`,
          parsedContainer,
          initialStatus,
          missingFields,
          conversation.id,
          accountId
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error initializing contact draft session:', err);
        const reply = "❌ *Failed to parse contact details.* Please copy paste details as text or send a clean contact screenshot.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }
    }
  }

  // Handle help command or general welcome instructions.
  // Skip if this is an interactive reply — those belong to the flow engine.
  if (!buttonId && (lowerText === 'help' || cleanedText)) {
    const reply = `👋 *AI Ingestion Chatbot*\n\n` +
      `Send property listing details or a contact profile (as text or screenshot) to automatically start a draft.\n\n` +
      `*Commands:* (only active during an active session)\n` +
      `• Send property photos to add them to listing\n` +
      `• Reply naturally to correct details (e.g., 'price is 1.8 Cr' or 'name is Suresh')\n` +
      `• Click the **Cancel** button to discard\n` +
      `• Click the **Confirm** button to save`;

    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  return false;
}

/** Reply id for the "Talk to an Agent" button shown when the account's
 *  property limit blocks a submission — mirrors the id used by
 *  `executeStartPropertyIntake` (flows/engine.ts) at entry time. */
const TALK_TO_AGENT_LIMIT_REPLY_ID = 'talk_to_agent_limit';

async function loadAccountContactInfo(accountId: string): Promise<{ phone: string; businessName: string }> {
  const { data } = await supabaseAdmin()
    .from('showcase_settings')
    .select('contact_phone, website_name')
    .eq('account_id', accountId)
    .maybeSingle();
  return {
    phone: data?.contact_phone ?? '',
    businessName: data?.website_name ?? '',
  };
}

async function sendPropertyLimitReachedReply(
  accountId: string,
  contactRecord: { id: string; phone: string },
  conversation: { id: string },
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  const { phone, businessName } = await loadAccountContactInfo(accountId);
  const text =
    `⚠️ *We're unable to accept new listings right now.*\n\n` +
    `${businessName ? `*${businessName}*'s` : "The property owner's"} account has reached its listing capacity. ` +
    `Please reach out to them directly to arrange your submission.` +
    (phone ? `\n\n📞 Call or WhatsApp: ${phone}` : '');

  const sendRes = await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to: contactRecord.phone,
    bodyText: text,
    buttons: [{ id: TALK_TO_AGENT_LIMIT_REPLY_ID, title: 'Talk to an Agent' }],
  });
  await saveBotMessage(conversation.id, text, sendRes.messageId);

  // Flag the conversation for staff — same signal executeHandoff uses.
  await supabaseAdmin()
    .from('conversations')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', conversation.id);
}

/**
 * Core processor for the "List My Property" WhatsApp intake — an
 * external agent/property owner (NOT CRM staff) drafting a listing via
 * the flow engine's `start_property_intake` node. Reuses the same
 * AI-parsed draft/preview/Confirm-Cancel UX as `processOwnerChatbotMessage`,
 * but every confirmed listing lands as `status: 'Pending Review'` /
 * `is_published: false` for the account owner to approve on Inventory.
 *
 * Deliberately narrower than the owner flow: no `contact_draft_sessions`,
 * no `classifyImageOrText` branching, no owner_contact_name-based contact
 * lookup/creation. This function must never create or touch a `contacts`
 * row beyond the one the webhook already resolved for the sender.
 *
 * Returns true if the message was handled/consumed, false otherwise.
 */
export async function processExternalListingMessage(
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
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  const { data: propSessionData, error: propSessionErr } = await supabaseAdmin()
    .from('property_draft_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .eq('session_mode', 'external')
    .maybeSingle();

  if (propSessionErr) {
    console.error('[chatbot-engine] Error fetching external listing draft session:', propSessionErr);
  }

  const propSession = propSessionData;
  if (!propSession) return false;

  // Session Expiry Timeout (15 minutes of inactivity) — mirrors the owner flow.
  const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  const updatedAt = new Date(propSession.updated_at).getTime();
  if (Date.now() - updatedAt > SESSION_TIMEOUT_MS) {
    console.log(`[chatbot-engine] Expiring inactive external listing session ${propSession.id}`);
    await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
    const reply = "⌛ *Your listing draft expired due to inactivity.* Please tap \"List My Property\" again to start a new one.";
    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  const cleanedText = contentText?.trim() || '';
  const lowerText = cleanedText.toLowerCase();
  const draft = propSession.draft_data as ParsedPropertyDraft;

  const buttonId = message.type === 'interactive'
    ? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id
    : null;

  // The account hit its property limit earlier in this session (see the
  // Confirm branch below) and we left the draft session alive so they
  // could retry. Re-share the same contact info rather than re-parsing
  // this tap as a draft correction.
  if (buttonId === TALK_TO_AGENT_LIMIT_REPLY_ID) {
    await sendPropertyLimitReachedReply(accountId, contactRecord, conversation, accessToken, phoneNumberId);
    return true;
  }

  // Handle CANCEL instruction
  if (buttonId === 'cancel_property' || lowerText === 'cancel') {
    await supabaseAdmin()
      .from('property_draft_sessions')
      .delete()
      .eq('id', propSession.id);

    const reply = "❌ *Listing draft discarded.* Send another property details text or photo to start again, or tap \"List My Property\" from the menu.";
    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  // Handle CONFIRM instruction
  if (buttonId === 'confirm_property' || lowerText === 'confirm') {
    const { isValid, missingFields } = validateDraft(draft);
    if (!isValid) {
      const reply = `⚠️ *Cannot confirm yet.* The following mandatory fields are missing:\n\n` +
        missingFields.map(f => `• *${f}*`).join('\n') +
        `\n\nPlease provide them first (e.g. 'price is 1.5 Cr', 'title is HSR 3BHK Apartment').`;
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    // Defensive re-check — executeStartPropertyIntake already checked
    // this at entry, but the account's count can move while this lister
    // was mid-draft (other submissions approved, etc). Leave the draft
    // session alive so they can retry without re-typing everything.
    const { limitReached } = await checkAccountPropertyLimit(supabaseAdmin(), accountId);
    if (limitReached) {
      await sendPropertyLimitReachedReply(accountId, contactRecord, conversation, accessToken, phoneNumberId);
      return true;
    }

    // Self-listing: the WhatsApp sender IS the owner/agent of this
    // property. Never look up or create another contact for it —
    // that's what the "never invoke contact creation" rule is about.
    const { data: prop, error: propErr } = await supabaseAdmin()
      .from('properties')
      .insert({
        account_id: accountId,
        user_id: null,
        title: draft.title!.trim(),
        description: draft.description || `Submitted via WhatsApp by an external lister, pending review.`,
        price: draft.listing_type === 'Rent' ? (draft.rent_per_month || 0) : (draft.price || 0),
        location: draft.location!.trim(),
        type: draft.type || 'Others',
        status: 'Pending Review',
        bedrooms: draft.bedrooms,
        bathrooms: draft.bathrooms,
        area_sqft: draft.area_sqft,
        sublocality: draft.sublocality,
        city: draft.city || 'Bangalore',
        state: draft.state || 'Karnataka',
        dimensions: draft.dimensions,
        facing_direction: draft.facing_direction,
        is_published: false,
        features: draft.features || [],
        nearby_highlights: draft.nearby_highlights || [],
        images: draft.images || [],
        rental_income: draft.rental_income,
        roi: draft.roi,
        google_map_link: draft.google_map_link,
        land_area: draft.land_area,
        land_area_unit: draft.land_area_unit || 'Sq.Ft.',
        owner_contact_id: contactRecord.id,
        listing_source: 'whatsapp_lister',
        listing_type: draft.listing_type || 'Sale',
        rent_per_month: draft.rent_per_month,
        maintenance: draft.maintenance,
        advance: draft.advance,
        gst: draft.gst,
      })
      .select()
      .single();

    if (propErr) {
      console.error('[chatbot-engine] Failed to save external listing:', propErr);
      const reply = "❌ *Error saving your listing.* Please try again later.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    await supabaseAdmin()
      .from('property_draft_sessions')
      .delete()
      .eq('id', propSession.id);

    // Deliberately no autoSyncPropertyCatalogIfNeeded call here — this
    // listing is unpublished and pending review; it must not reach the
    // public WhatsApp catalog until the account owner approves it.

    let reply = `✅ *Thanks! Your property listing has been submitted.*\n\n` +
      `*Code:* ${prop.property_code}\n` +
      `*Title:* ${prop.title}\n` +
      `*Price:* ₹${prop.price.toLocaleString('en-IN')}\n` +
      `*Location:* ${prop.location}\n` +
      `*Type:* ${prop.type}\n`;

    if (prop.features && prop.features.length > 0) {
      reply += `*Amenities:* ${prop.features.join(', ')}\n`;
    }
    if (prop.nearby_highlights && prop.nearby_highlights.length > 0) {
      reply += `*Nearby Highlights:* ${prop.nearby_highlights.join(', ')}\n`;
    }

    reply += `\n🕐 *Pending review* — our team will verify the details and publish it shortly.`;

    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  // Handle image upload inside active session
  if (message.type === 'image' && message.image?.id) {
    const uploadMsg = "⏳ _Uploading photo to draft listing... Please wait._";
    const uploadSendRes = await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: contactRecord.phone,
      text: uploadMsg
    });
    await saveBotMessage(conversation.id, uploadMsg, uploadSendRes.messageId);

    try {
      const mediaId = message.image.id;
      const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });

      const publicUrl = await uploadPropertyImage(accountId, buffer, mimeType);

      let updatedDraft = draft;
      let success = false;
      let retryCount = 0;
      const maxRetries = 5;
      let finalUpdateData: { updated_at: string }[] | null = null;

      while (retryCount < maxRetries && !success) {
        const { data: latestSession, error: fetchErr } = await supabaseAdmin()
          .from('property_draft_sessions')
          .select('*')
          .eq('id', propSession.id)
          .single();

        if (fetchErr || !latestSession) {
          if (fetchErr?.code === 'PGRST116') {
            console.log('[chatbot-engine] Active external session was deleted concurrently. Exiting photo upload flow.');
            return true;
          }
          throw fetchErr || new Error('Session not found during image append retry');
        }

        const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
        const currentImages = currentDraft.images || [];
        const updatedImages = currentImages.includes(publicUrl)
          ? currentImages
          : [...currentImages, publicUrl];

        updatedDraft = { ...currentDraft, images: updatedImages };

        const validation = validateDraft(updatedDraft);
        const nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';

        const { data: updateData, error: updateErr } = await supabaseAdmin()
          .from('property_draft_sessions')
          .update({
            draft_data: updatedDraft,
            status: nextStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', propSession.id)
          .eq('updated_at', latestSession.updated_at)
          .select();

        if (!updateErr && updateData && updateData.length > 0) {
          success = true;
          finalUpdateData = updateData;
        } else {
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));
        }
      }

      if (!success || !finalUpdateData || finalUpdateData.length === 0) {
        throw new Error('Failed to update external draft session due to concurrent modifications');
      }

      const savedTime = finalUpdateData[0].updated_at;

      sendPropertyDraftPreviewDebounced(
        propSession.id,
        savedTime,
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📸 *Photo added successfully!* Total photos attached: *${updatedDraft.images.length}*.`,
        conversation.id
      );
      return true;
    } catch (err) {
      console.error('[chatbot-engine] Error processing external listing photo upload:', err);
      const reply = "❌ *Failed to upload image.* Please verify the photo format and try again.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }
  }

  // Handle conversational update/correction text.
  //
  // Re-fetches + retries with an optimistic-lock precondition (same
  // pattern as the image-upload branch above), instead of blindly
  // overwriting `draft_data` from the snapshot read at the top of this
  // call — otherwise two corrections landing close together each
  // build on the same stale base and the second write silently
  // clobbers the first.
  if (cleanedText) {
    let updatedDraft = draft;
    let nextStatus: string = propSession.status;
    let success = false;
    let retryCount = 0;
    const maxRetries = 5;
    let finalUpdateData: { updated_at: string }[] | null = null;

    while (retryCount < maxRetries && !success) {
      const { data: latestSession, error: fetchErr } = await supabaseAdmin()
        .from('property_draft_sessions')
        .select('*')
        .eq('id', propSession.id)
        .single();

      if (fetchErr || !latestSession) {
        if (fetchErr?.code === 'PGRST116') {
          console.log('[chatbot-engine] Active external session was deleted concurrently. Exiting text update flow.');
          return true;
        }
        throw fetchErr || new Error('Session not found during text update retry');
      }

      const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
      await softBurn(accountId, 'chatbot_classify');
      updatedDraft = await updateListingDraft(currentDraft, cleanedText);
      updatedDraft = await backfillLocationFromMapLink(updatedDraft);

      const validation = validateDraft(updatedDraft);
      nextStatus = validation.isValid ? 'awaiting_confirmation' : 'collecting';

      const { data: updateData, error: updateErr } = await supabaseAdmin()
        .from('property_draft_sessions')
        .update({
          draft_data: updatedDraft,
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', propSession.id)
        .eq('updated_at', latestSession.updated_at)
        .select();

      if (!updateErr && updateData && updateData.length > 0) {
        success = true;
        finalUpdateData = updateData;
      } else {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));
      }
    }

    if (!success || !finalUpdateData || finalUpdateData.length === 0) {
      const reply = "⚠️ *Couldn't save your update due to a conflicting change.* Please resend it.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }

    const actualSavedTime = finalUpdateData[0].updated_at;

    sendPropertyDraftPreviewDebounced(
      propSession.id,
      actualSavedTime,
      phoneNumberId,
      accessToken,
      contactRecord.phone,
      `📝 *Draft Listing Updated:*`,
      conversation.id
    );
    return true;
  }

  return true;
}

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^\d.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
