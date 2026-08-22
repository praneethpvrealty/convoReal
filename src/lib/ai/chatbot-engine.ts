import { phonesMatch, normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';
import { BRANDING } from '@/config/branding';
import type { Contact } from '@/types';
import { 
  parseListingFromImageOrText, 
  updateListingDraft, 
  type ParsedPropertyDraft,
  classifyImageOrText,
  looksLikeBuyerRequirement,
  draftReadsAsRequirement,
  parseContactFromImageOrText,
  parseClientReplyFromImageOrText,
  updateContactDraft,
  transcribeVoiceNote,
  type ParsedContactDraftsContainer,
  normalizeClassification
} from '@/lib/ai/gemini';
import {
  processClientReplyScreenshot,
  completeClientResponseProperty,
  completeClientReplyContact,
  completeClientReplyForContactId,
  parseClientCandidateReplyId,
  handleAgentFollowupReply,
  AGENT_FOLLOWUP_PREFIX,
  type ClientReplyOutcome,
} from '@/lib/journey/client-response';
import { parseClientNameAnswer } from '@/lib/journey/client-answer';
import {
  parkClientReply,
  takePendingClientReply,
} from '@/lib/journey/pending-client-reply';
import { applyListingDerivations } from '@/lib/ai/listing-derivations';
import { uploadPropertyImage, uploadPropertyVideo, DocumentTooLargeError } from '@/lib/storage/upload';
import { queueYouTubeUploadIfConnected } from '@/lib/youtube/upload';
import { sanitizeFloorTenancies } from '@/lib/inventory/floor-tenancies';
import {
  sendTextMessage,
  downloadMedia,
  getMediaUrl,
  sendInteractiveButtons,
  sendReactionMessage
} from '@/lib/whatsapp/meta-api';
import { autoSyncPropertyCatalogIfNeeded } from '@/lib/whatsapp/catalog-sync-helper';
import { uploadBrochureImages, storeBrochureDocument } from '@/lib/pdf/brochure-images';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import { pinBrochurePlans, sanitizeFloorPlans, plansWithImages } from '@/lib/inventory/floor-plans';
import { checkAccountPropertyLimit } from '@/lib/billing/gates';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS, type AiFeatureKey } from '@/lib/credits/types';
import { notifyManagerLowBalance } from '@/lib/credits/notify';
import { tryHandleOwnerScheduling, applySchedulingEdit, isDictatedTaskList } from '@/lib/calendar/whatsapp-scheduler';
import {
  enrichmentFor,
  matchContactByExactName,
  phoneLinkButtonTitle,
  suggestPhoneLink,
  type BookContact,
  type PhoneLinkSuggestion,
} from '@/lib/contacts/draft-match';
import {
  parsePropertyAnswer,
  PROPERTY_QUESTION_FINGERPRINT,
} from '@/lib/journey/property-answer';
import { syncContactPreferences } from '@/lib/contacts/preference-sync';
import { parseEventOutcome } from '@/lib/calendar/event-outcome';
import {
  openOverdueEvents,
  subjectOf,
  openEventLabel,
  type OpenEventSubject,
} from '@/lib/calendar/open-event-subject';
import { recordBotTarget, resolveBotTarget, latestBotTarget, latestBotTargetForPrompt, clearBotTarget } from '@/lib/whatsapp/bot-message-target';
import { resolveReplayTarget, replayText } from '@/lib/whatsapp/message-replay';
import { applyRecordUpdate } from '@/lib/ai/record-edit';
import { matchProjectByName } from '@/lib/inventory/projects';
import {
  isOwnerHelpCommand,
  buildOwnerHelpMessage,
  buildOwnerFallbackMessage,
} from '@/lib/whatsapp/owner-help-template';
import {
  validateDraft,
  validateContactDraftsContainer,
  reconcileContactDrafts,
  applyExplicitContactDraftUpdate,
  formatDraftPreviewMessage,
  formatContactDraftsPreview,
  backfillLocationFromMapLink,
} from '@/lib/ai/intake-core';
import {
  parseSharedContactCards,
  applySharedCardOwner,
  fileSharedCardContact,
  contactDraftsFromCards,
} from '@/lib/contacts/shared-cards';
import { extractMapLinkFromText } from '@/lib/maps/map-links';
import {
  parkMapPin,
  takePendingMapPin,
  applyPinToDraft,
  buildPinParkedMessage,
} from '@/lib/maps/pending-pin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { recordRequirementResponse } from '@/lib/requirements/respond';

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
 * Saves a bot reply message in the Engine database thread and updates the conversation state.
 */
export async function saveBotMessage(
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
        updated_at: new Date().toISOString(),
        awaiting_reply: false
      })
      .eq('id', conversationId);

    if (convErr) {
      console.error('[chatbot-engine] Error updating conversation status:', convErr);
    }
  } catch (err) {
    console.error('[chatbot-engine] Exception in saveBotMessage:', err);
  }
}

/** The headline a saved listing is confirmed back with. A joint
 *  development saves with a price of 0 — quoting that back reads as a
 *  free property, so its terms take the line instead. */
function dealHeadline(prop: {
  listing_type?: string | null;
  price: number;
  jv_structure?: string | null;
  owner_share_percent?: number | null;
  builder_share_percent?: number | null;
}): string {
  if (prop.listing_type !== 'JV/JD') {
    return `*Price:* ₹${prop.price.toLocaleString('en-IN')}\n`;
  }
  const structure = prop.jv_structure ? ` — ${prop.jv_structure}` : '';
  const share =
    prop.owner_share_percent || prop.builder_share_percent
      ? ` (Owner ${prop.owner_share_percent ?? '?'} : ${prop.builder_share_percent ?? '?'} Builder)`
      : '';
  return `*Deal:* JV / Joint Development${structure}${share}\n`;
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

// How long the draft must sit quiet before the confirmation card goes
// out. Media arrivals "touch" the session immediately (see
// reactToInboundMessage / touchDraftSession below), so while an album
// is still streaming in, every earlier preview thread sees a newer
// write and yields — the user gets ONE final card, not one per photo.
const DRAFT_PREVIEW_DEBOUNCE_MS = 8000;

// How long a draft stays answerable after the last message on it. The
// confirmation card is often read long after it lands, so Confirm,
// Cancel and plain-language corrections all keep working for an hour
// before the draft is discarded.
export const DRAFT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

/** Lightweight per-media ack: a reaction on the user's own message
 *  (⏳ while uploading, ✅ when attached) instead of a chat bubble.
 *  Best-effort — a failed reaction never blocks the upload. */
async function reactToInboundMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  targetMessageId: string | undefined,
  emoji: string
): Promise<void> {
  if (!targetMessageId) return;
  try {
    await sendReactionMessage({ phoneNumberId, accessToken, to, targetMessageId, emoji });
  } catch (err) {
    console.warn('[chatbot-engine] media ack reaction failed (non-fatal):', err);
  }
}

/** Touch the draft session's updated_at BEFORE the slow media
 *  download/upload, so any older pending preview thread sees a newer
 *  write and yields its confirmation card to this one. */
async function touchDraftSession(sessionId: string): Promise<void> {
  try {
    await supabaseAdmin()
      .from('property_draft_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch (err) {
    console.warn('[chatbot-engine] draft arrival touch failed (non-fatal):', err);
  }
}

/** Start of the dropped-brochure note, so the header rewrites in
 *  sendPropertyDraftPreview() can find and preserve it. */
const BROCHURE_NOTE_MARKER = '\n\n📄 _The ';

/**
 * Tells the sender their brochure was read but not kept.
 *
 * Silence here would read as the file having uploaded — the draft shows
 * "Documents: 0 attached" and nothing explains it, which is the exact
 * confusion this whole path exists to remove. Empty string when the
 * document stored fine, so the caller can always concatenate.
 */
function brochureDroppedNote(bytes: number | null): string {
  if (!bytes) return '';
  const mb = (bytes / (1024 * 1024)).toFixed(0);
  const limitMb = Math.round(DOCUMENT_SIZE_LIMIT / (1024 * 1024));
  return (
    `${BROCHURE_NOTE_MARKER}${mb} MB file was too large to store (limit ${limitMb} MB), ` +
    `so I kept what was in it — details, photos and floor plans — and discarded the file itself. ` +
    `Send a compressed copy if you need the brochure attached._`
  );
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
    // Wait for concurrent uploads/messages to settle
    await new Promise((resolve) => setTimeout(resolve, DRAFT_PREVIEW_DEBOUNCE_MS));

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

    // Customize header counts — this thread may be summarizing several
    // attachments that landed after the header string was built. The
    // rewrites below replace the whole header, so any note appended by
    // the caller is lifted off first and put back after; losing it would
    // leave a dropped brochure unexplained.
    const noteAt = header.indexOf(BROCHURE_NOTE_MARKER);
    const note = noteAt === -1 ? '' : header.slice(noteAt);
    const base = noteAt === -1 ? header : header.slice(0, noteAt);
    let finalHeader = header;
    if (base.includes('Photo added successfully') || base.includes('Photos added successfully')) {
      finalHeader = `📸 *Photos added successfully!* Total photos attached: *${latestDraft.images.length}*.` + note;
    } else if (base.includes('Document added successfully') || base.includes('Documents added successfully')) {
      // A brochure usually arrives carrying pictures too. Saying so is
      // what tells the sender the PDF was read, not merely filed.
      const plans = plansWithImages(latestDraft.floor_plans).length;
      const extras = [
        latestDraft.images.length ? `*${latestDraft.images.length}* photo(s)` : '',
        plans ? `*${plans}* floor plan(s)` : '',
      ].filter(Boolean);
      finalHeader =
        `📄 *Documents added successfully!* Total documents attached: *${(latestDraft.documents || []).length}*.` +
        (extras.length ? `\nRead from the brochure: ${extras.join(' and ')}.` : '') +
        note;
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
          const normalized = normalizePhoneWithCountryCode(draft.phone);
          const cleanPhone = normalized.replace(/\D/g, '');
          const { data: byPhone } = await supabaseAdmin()
            .from('contacts')
            .select('id, name')
            .eq('account_id', accountId)
            .or(`phone.eq."${String(draft.phone).replace(/[\\"]/g, '\\$&')}",phone.eq.${normalized},phone.eq.${cleanPhone}`)
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
          // A phone match is no longer an obstacle: confirming enriches
          // that contact instead of creating a second one, so telling
          // the agent to "type a different number" would talk them out
          // of exactly what they forwarded the chat to do.
          //
          // A NAME match with a different number is still worth a
          // caution, because it genuinely does create a second row —
          // namesakes are common and only the agent can tell them apart.
          return matchType === 'phone'
            ? `\n♻️ *Already in your contacts as "${existingContact.name}".* Confirming updates them with anything new above — it will not create a second contact.`
            : `\n⚠️ *A different contact named "${draft.name}" already exists* on another number. Confirming creates a second one — cancel and edit the name if they are the same person.`;
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

/**
 * The book row a phoneless draft contact looks like, if exactly one
 * does. Never throws: a lookup failure must leave the card renderable,
 * because losing the whole preview over a missing suggestion is a
 * worse trade than showing it without one.
 */
async function suggestContactLink(
  container: ParsedContactDraftsContainer,
  accountId: string
): Promise<PhoneLinkSuggestion | null> {
  try {
    const drafts = container.contacts || [];
    if (!drafts.some((c) => !(c.phone || '').trim())) return null;
    const { data } = await supabaseAdmin()
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .eq('is_merged', false);
    return suggestPhoneLink(drafts, (data || []) as BookContact[]);
  } catch (err) {
    console.error('[chatbot-engine] contact link suggestion failed:', err);
    return null;
  }
}

async function resolveExactContactLinks(
  container: ParsedContactDraftsContainer,
  accountId: string
): Promise<ParsedContactDraftsContainer> {
  const drafts = container.contacts || [];
  if (!drafts.some((contact) => !(contact.phone || '').trim())) return container;
  try {
    const { data } = await supabaseAdmin()
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .eq('is_merged', false);
    const book = (data || []) as BookContact[];
    return {
      contacts: drafts.map((draft) => {
        if ((draft.phone || '').trim()) return draft;
        const exact = matchContactByExactName(draft.name, book);
        return exact?.phone ? { ...draft, phone: exact.phone } : draft;
      }),
    };
  } catch (err) {
    console.error('[chatbot-engine] exact contact link failed:', err);
    return container;
  }
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
  const resolvedContainer = await resolveExactContactLinks(container, accountId);
  const resolvedValidation = validateContactDraftsContainer(resolvedContainer);
  const resolvedStatus = resolvedValidation.isValid ? 'awaiting_confirmation' : nextStatus;
  let reply = await formatContactDraftsContainerPreview(
    header,
    resolvedContainer,
    resolvedStatus,
    resolvedValidation.isValid ? [] : missingFields,
    accountId
  );

  const buttons = resolvedStatus === 'awaiting_confirmation'
    ? [
        { id: 'confirm_contact', title: 'Confirm' },
        { id: 'cancel_contact', title: 'Cancel' }
      ]
    : [
        { id: 'cancel_contact', title: 'Cancel' }
      ];

  // A forwarded chat header gives a name and no number, and phone is
  // required to confirm — so a chat about someone already in the book
  // dead-ends on "Phone: ❓ Missing". Offer their number rather than
  // filling it in: the match is deterministic and refuses anything
  // ambiguous, but a wrong one files the conversation against a
  // stranger, and nobody catches that by reading the contact later.
  const suggestion = await suggestContactLink(resolvedContainer, accountId);
  if (suggestion) {
    reply +=
      `\n\n💡 *${suggestion.contact.name}* (${suggestion.contact.phone}) is already ` +
      `in your contacts and looks like the same person. Tap below to use their number.`;
    buttons.unshift({
      id: `link_contact:${suggestion.contact.id}`,
      title: phoneLinkButtonTitle(suggestion.contact.name),
    });
  }

  const sendRes = await sendInteractiveButtons({
    phoneNumberId,
    accessToken,
    to,
    bodyText: reply,
    buttons: buttons.slice(0, 3)
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
    video?: { id: string; mime_type: string };
    document?: { id: string; mime_type: string; filename?: string };
    audio?: { id: string; mime_type: string };
    interactive?: {
      type: 'button_reply' | 'list_reply' | 'nfm_reply';
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
      nfm_reply?: { name?: string; body?: string; response_json: string };
    };
    /** Set by WhatsApp on a quote-reply: the wamid being replied to. */
    context?: { id: string };
  },
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string },
  conversation: { id: string },
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

  const isAudioMsg = message.type === 'audio' && !!message.audio?.id;

  // A voice note is the same request said out loud, so it is transcribed
  // once here and read as text by every path below — draft corrections,
  // the calendar, listing and contact intake alike.
  //
  // Audio used to reach exactly one destination: the calendar parser. A
  // dictated listing was therefore forced into an event or answered with
  // "I couldn't find an event in that" — and a voice note that arrived
  // while a draft was open matched no branch at all and got silence, no
  // reply and nothing saved.
  let spokenText = '';
  if (isAudioMsg) {
    if (!(await gatedBurn(accountId, 'voice_transcribe'))) {
      return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
    }
    try {
      const { url, mimeType } = await getMediaUrl({ mediaId: message.audio!.id, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
      spokenText = await transcribeVoiceNote(buffer, mimeType || message.audio!.mime_type || 'audio/ogg');
    } catch (err) {
      console.error('[chatbot-engine] voice note transcription failed:', err);
    }

    if (!spokenText) {
      const reply =
        "🎙 *I couldn't make out that voice note.* Try again somewhere quieter, or type it out — I can take a listing, a contact, or something to schedule either way.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      return true;
    }
  }

  const cleanedText = (spokenText || contentText || '').trim();
  const lowerText = cleanedText.toLowerCase();

  const isImageMsg = message.type === 'image' && message.image?.id;
  const isDocMsg = message.type === 'document' && message.document?.id;
  const isVideoMsg = message.type === 'video' && message.video?.id;
  const isMediaMsg = isImageMsg || isDocMsg || isVideoMsg;

  // A forwarded vCard is a person. WhatsApp says so structurally, so
  // there is nothing here to classify and nothing to pay for — and
  // guessing was actively worse: a phonebook name like "Nadeem
  // Koramangala 8th Block 2100 Sqft Corner" carries enough listing
  // words to beat the person under the classifier's own precedence
  // rule, which was written for forwarded ad copy that happens to
  // quote an agent's number, not for a card.
  const isContactCardMsg = message.type === 'contacts';

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

  // 1.5. Session Expiry Timeout (an hour of inactivity)
  const now = Date.now();

  if (propSession) {
    const updatedAt = new Date(propSession.updated_at).getTime();
    if (now - updatedAt > DRAFT_SESSION_TIMEOUT_MS) {
      console.log(`[chatbot-engine] Expiring inactive property draft session ${propSession.id}`);
      await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
      propSession = null;
    }
  }

  if (contactSession) {
    const updatedAt = new Date(contactSession.updated_at).getTime();
    if (now - updatedAt > DRAFT_SESSION_TIMEOUT_MS) {
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
    if (isImageMsg || isDocMsg || isVideoMsg) {
      const mediaId = isImageMsg
        ? message.image!.id
        : isDocMsg
          ? message.document!.id
          : message.video!.id;
      const { url, mimeType } = await getMediaUrl({ mediaId, accessToken });
      const { buffer } = await downloadMedia({ downloadUrl: url, accessToken });
      inboundMediaBuffer = buffer;
      inboundMediaMime = mimeType;
    }
    return { buffer: inboundMediaBuffer, mimeType: inboundMediaMime };
  }

  // A forwarded chat where a client answers about an already-shared
  // listing: parse the response, log it against the journey, and ask
  // the client for a timeline. Shared by the fresh-intake fork and the
  // contact-session task switch — the reply is context to record, never
  // a draft to open.
  async function runClientReplyCapture(): Promise<boolean> {
    if (!(await gatedBurn(accountId, 'contact_parse'))) {
      return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
    }
    const analyzingMsg = "⏳ _Reading the client's reply... Please wait._";
    const analyzingSendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: analyzingMsg });
    await saveBotMessage(conversation.id, analyzingMsg, analyzingSendRes.messageId);

    let outcome: ClientReplyOutcome;
    try {
      const media = isImageMsg ? await loadInboundMedia() : { buffer: undefined, mimeType: undefined };
      const parsed = await parseClientReplyFromImageOrText(cleanedText || undefined, media.buffer, media.mimeType);
      outcome = await processClientReplyScreenshot({
        db: supabaseAdmin(),
        accountId,
        userId,
        parsed,
        accessToken,
        phoneNumberId,
        excludeContactId: contactRecord.id,
      });
      // Nobody matched, so the reply asks who this is. Hold the parse
      // until that answer arrives — discarding it made the agent
      // forward the whole conversation a second time.
      if (outcome.unmatched) {
        await parkClientReply({
          accountId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          parsed,
        });
      }
    } catch (err) {
      console.error('[chatbot-engine] client reply capture failed:', err);
      outcome = { text: "⚠️ I couldn't read that conversation. Try a clearer screenshot, or type the client's update (e.g. \"Surya will speak to the chairman on PROP-1138\")." };
    }
    // The three reminder buttons ride on the confirmation itself, so the
    // agent can set a follow-up in the same tap-free turn.
    const sendRes = outcome.buttons
      ? await sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to: contactRecord.phone,
          bodyText: outcome.text,
          buttons: outcome.buttons,
        })
      : await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: outcome.text });
    await saveBotMessage(conversation.id, outcome.text, sendRes.messageId);
    // The response is logged but its listing is still unknown. Register
    // the question against the message that asks it, so the code the
    // agent types next completes this instead of reading as a new
    // listing — which is what it used to do, opening a draft with every
    // field Missing.
    if (outcome.pendingPropertyContactId) {
      await recordBotTarget({
        accountId,
        waMessageId: sendRes.messageId,
        entityType: 'contact',
        entityId: outcome.pendingPropertyContactId,
      });
    }
    return true;
  }

  // 1.67. A tap is an instruction carried in its button id — the text
  // is only the label. The id dispatches run here, before every
  // free-text reader below, and the interpretive corridor (1.66 down
  // to the scheduling intercept) is gated on isInteractiveTap: live, a
  // "Today itself" reminder tap read as a listing lookup, and a bare
  // "Cancel" label satisfies the appointment-outcome regex outright.
  // Session buttons (confirm/cancel) are read by their own session
  // blocks further down, which this does not touch.
  const isInteractiveTap = message.type === 'interactive';
  const buttonId = isInteractiveTap
    ? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id
    : null;

  // 1.675. The tap that names the client a parked forward is about.
  //
  // The who-question now offers the two or three contacts the thread
  // itself points at, each with the reason it is offered. A tap names
  // the contact outright, so nothing is resolved and nothing is
  // guessed — the parked parse is claimed and logged against them.
  const tappedCandidateId = buttonId
    ? parseClientCandidateReplyId(buttonId)
    : null;
  if (tappedCandidateId) {
    const parkedReply = await takePendingClientReply({
      accountId,
      contactId: contactRecord.id,
    });
    let text: string;
    let outcome: ClientReplyOutcome | null = null;
    if (!parkedReply) {
      text = "⌛ That conversation has aged out — forward it again and I'll read it against that contact.";
    } else {
      outcome = await completeClientReplyForContactId({
        db: supabaseAdmin(),
        accountId,
        userId,
        contactId: tappedCandidateId,
        parsed: parkedReply,
        accessToken,
        phoneNumberId,
      });
      if (!outcome) {
        await parkClientReply({
          accountId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          parsed: parkedReply,
        });
      }
      text =
        outcome?.text ??
        "❓ I couldn't find that contact any more. Reply with the name as it's saved in your book.";
    }
    const sendRes = outcome?.buttons
      ? await sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to: contactRecord.phone,
          bodyText: text,
          buttons: outcome.buttons,
        })
      : await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text });
    await saveBotMessage(conversation.id, text, sendRes.messageId);
    if (outcome?.pendingPropertyContactId) {
      await recordBotTarget({
        accountId,
        waMessageId: sendRes.messageId,
        entityType: 'contact',
        entityId: outcome.pendingPropertyContactId,
      });
    }
    return true;
  }

  // The agent setting their own follow-up date on a client's branch.
  if (buttonId?.startsWith(AGENT_FOLLOWUP_PREFIX)) {
    const handledAgentFollowup = await handleAgentFollowupReply({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: userId,
      contact: { id: contactRecord.id, name: contactRecord.name, phone: contactRecord.phone },
      conversationId: conversation.id,
      replyId: buttonId,
    });
    if (handledAgentFollowup) return true;
  }

  // 1.665. The answer to "who is this client?".
  //
  // A forwarded chat whose client could not be matched leaves the
  // parse parked against this sender, and the agent answers with the
  // name — "Natarajan is already a contact in our application". That
  // sentence used to reach the intake classifier and come back as "I
  // couldn't tell what that was", with the client's actual reply
  // already parsed and thrown away.
  //
  // Both gates are deterministic and free: a parse of this sender's
  // own has to be parked and still fresh, and the text has to read as
  // nothing but a person's name. The parked row is consumed on read,
  // so a name typed later cannot re-file the same response.
  if (cleanedText && !isInteractiveTap && !propSession && !contactSession) {
    const namedClient = parseClientNameAnswer(cleanedText);
    if (namedClient) {
      const parkedReply = await takePendingClientReply({
        accountId,
        contactId: contactRecord.id,
      });
      if (parkedReply) {
        const outcome = await completeClientReplyContact({
          db: supabaseAdmin(),
          accountId,
          userId,
          name: namedClient,
          parsed: parkedReply,
          accessToken,
          phoneNumberId,
          excludeContactId: contactRecord.id,
        });
        const text =
          outcome?.text ??
          `❓ I couldn't find one contact called *${namedClient}* in your book. Send their contact card and I'll save them, or reply with the name exactly as it's filed.`;
        // Unresolved: park the parse again so the corrected name still
        // has something to complete.
        if (!outcome) {
          await parkClientReply({
            accountId,
            contactId: contactRecord.id,
            conversationId: conversation.id,
            parsed: parkedReply,
          });
        }
        const sendRes = outcome?.buttons
          ? await sendInteractiveButtons({
              phoneNumberId,
              accessToken,
              to: contactRecord.phone,
              bodyText: text,
              buttons: outcome.buttons,
            })
          : await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text });
        await saveBotMessage(conversation.id, text, sendRes.messageId);
        if (outcome?.pendingPropertyContactId) {
          await recordBotTarget({
            accountId,
            waMessageId: sendRes.messageId,
            entityType: 'contact',
            entityId: outcome.pendingPropertyContactId,
          });
        }
        return true;
      }
    }
  }

  // 1.66. The answer to "which property is this about?".
  //
  // A forwarded client reply that named no listing is logged against
  // the contact, and the agent is asked which listing it belongs to.
  // The answer comes back as the code alone — "Prop-1194" — which the
  // listing classifier read as a brand-new listing and turned into a
  // draft with every field Missing, while the response it was meant to
  // complete stayed unlinked.
  //
  // Both gates are deterministic and free: the text has to read as
  // nothing but a listing reference, and the bot's own question has to
  // be standing in this thread with the contact registered against it.
  // Anything else falls through untouched.
  //
  // Never a tap: an interactive reply carries its instruction in the
  // button id and only its LABEL in the text — live, "Today itself"
  // (the follow-up reminder button on the completion card itself) read
  // as a listing name here and was answered with "couldn't find Today
  // itself in your inventory" while the reminder never got set. Taps
  // belong to their id dispatchers below.
  //
  if (cleanedText && !isInteractiveTap && !propSession) {
    const propertyAnswer = parsePropertyAnswer(cleanedText);
    if (propertyAnswer) {
      const pending = await latestBotTargetForPrompt({
        accountId,
        conversationId: conversation.id,
        entityType: 'contact',
        prompt: PROPERTY_QUESTION_FINGERPRINT,
      });
      if (pending) {
        const outcome = await completeClientResponseProperty({
          db: supabaseAdmin(),
          accountId,
          userId,
          contactId: pending.entityId,
          answer: propertyAnswer,
          accessToken,
          phoneNumberId,
        });
        // Answered: the question stops standing, so later short
        // messages — including this card's own reminder buttons —
        // cannot re-trigger it. An unresolved code leaves it standing
        // for the corrected retry.
        if (outcome) {
          await clearBotTarget({
            accountId,
            waMessageId: pending.waMessageId,
          });
        }
        const text =
          outcome?.text ??
          `❓ I couldn't find *${propertyAnswer.code || propertyAnswer.title}* in your inventory. Check the code and send it again — or open the listing and share it here.`;
        const sendRes = outcome?.buttons
          ? await sendInteractiveButtons({
              phoneNumberId,
              accessToken,
              to: contactRecord.phone,
              bodyText: text,
              buttons: outcome.buttons,
            })
          : await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text });
        await saveBotMessage(conversation.id, text, sendRes.messageId);
        return true;
      }
    }
  }

  // 1.65. Quote-reply on a confirmation card = a correction to the row
  // that card announced (migration 185). Without this the correction
  // reads as a brand-new request and creates a duplicate. A target that
  // is gone or no longer editable falls through to the create paths, so
  // the correction still lands — the reply just says "added" not
  // "updated".
  let editTarget = cleanedText && !isInteractiveTap
    ? await resolveBotTarget({ accountId, contextId: message.context?.id })
    : null;

  // 1.64. The answer to "how did it go?".
  //
  // The nudge asks a direct question, and the answer comes back the way
  // it would to a person — often with no quote at all, and never with
  // any obligation to quote the right thing. Both card lookups are
  // message plumbing: the newest registered card in the thread first,
  // and then, when there is no card to find, the agent's own open
  // events. A bot that can only be answered about messages it sent
  // after a particular deploy is not answerable.
  //
  // parseEventOutcome is the gate, and it is deterministic and free:
  // the text has to already read as "it happened" or "it's off" before
  // anything is looked up. Anything vaguer falls through to the paths
  // below untouched.
  let outcomeSubject: OpenEventSubject | null = null;
  if (!editTarget && cleanedText && !isInteractiveTap && parseEventOutcome(cleanedText)) {
    editTarget = await latestBotTarget({
      accountId,
      conversationId: conversation.id,
      entityType: 'appointment',
    });

    if (!editTarget) {
      outcomeSubject = subjectOf(
        await openOverdueEvents({ db: supabaseAdmin(), accountId, userId })
      );
      // One open overdue event and a sentence reporting an outcome is
      // not a guess. Several is — closing the wrong meeting is worse
      // than asking, so 'many' falls through to the reply below.
      if (outcomeSubject.kind === 'one') {
        editTarget = { entityType: 'appointment', entityId: outcomeSubject.event.id };
      }
    }
  }

  // Several open events and no card to say which: name them and let
  // the agent point, rather than answering "I couldn't tell what that
  // was" to a sentence that was perfectly clear.
  if (outcomeSubject?.kind === 'many') {
    const reply = [
      '🤔 *Which one do you mean?*',
      ...outcomeSubject.events.map((e) => `• ${openEventLabel(e)}`),
      '',
      '_Reply to the reminder for that one, or name it._',
    ].join('\n');
    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  if (editTarget) {
    try {
      if (editTarget.entityType === 'appointment' || editTarget.entityType === 'todo') {
        const outcome = await applySchedulingEdit({
          target: { entityType: editTarget.entityType, entityId: editTarget.entityId },
          instruction: cleanedText,
          contactRecord,
          conversation,
          accountId,
          userId,
          accessToken,
          phoneNumberId,
        });
        if (outcome === 'edited') return true;
      } else {
        if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
          return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
        }
        const result = await applyRecordUpdate({
          entityType: editTarget.entityType,
          entityId: editTarget.entityId,
          accountId,
          instruction: cleanedText,
        });
        if (result && result !== 'stale') {
          const label = editTarget.entityType === 'contact' ? 'Contact updated' : 'Listing updated';
          const lines = Object.entries(result).map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`);
          const reply = [`✏️ *${label}*`, ...lines, '', '_Reply to this message again to make another change._'].join('\n');
          const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
          await saveBotMessage(conversation.id, reply, sendRes.messageId);
          await recordBotTarget({
            accountId,
            waMessageId: sendRes.messageId,
            entityType: editTarget.entityType,
            entityId: editTarget.entityId,
          });
          return true;
        }
        if (result === null) {
          const reply = "🤔 I couldn't find a change to make from that. Tell me what to set, e.g. _\"change the price to 1.2 crore\"_.";
          const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
          await saveBotMessage(conversation.id, reply, sendRes.messageId);
          return true;
        }
      }
    } catch (err) {
      console.error('[chatbot-engine] quote-reply edit failed:', err);
    }
  }

  // 1.66. Quote-reply on the owner's OWN earlier message = run it again.
  //
  // A forwarded listing whose draft expired unconfirmed is still sitting
  // in the thread, so "add this one" pointed at it is the obvious move —
  // and it did nothing, because the intake read the two words of the
  // reply instead of the listing they were aimed at.
  //
  // Only once no bot target claimed the reply (that is an edit, and it
  // wins) and only with no draft open, so a correction mid-intake is
  // never mistaken for a replay. The synthetic message carries no
  // `context`, which is what stops this re-entering itself.
  if (!editTarget && !isInteractiveTap && !propSession && !contactSession && message.context?.id) {
    const replaySource = await resolveReplayTarget(
      supabaseAdmin(),
      conversation.id,
      message.context.id
    );
    if (replaySource) {
      // Meta keeps media for around 30 days, and the whole point of this
      // path is old messages. Check before re-entering: a throw deep in
      // the intake would surface as silence, where "forward it again" is
      // something the owner can act on.
      if (replaySource.mediaId) {
        try {
          await getMediaUrl({ mediaId: replaySource.mediaId, accessToken });
        } catch {
          const reply =
            "⌛ *That file has expired on WhatsApp* — Meta only keeps it for about 30 days. Please forward the photo or PDF again and I'll pick it up.";
          const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
          await saveBotMessage(conversation.id, reply, sendRes.messageId);
          return true;
        }
      }

      console.log(`[chatbot-engine] replaying message ${replaySource.id} from quote-reply`);
      return await processOwnerChatbotMessage(
        {
          ...message,
          type: replaySource.contentType,
          image:
            replaySource.contentType === 'image' && replaySource.mediaId
              ? { id: replaySource.mediaId, mime_type: '' }
              : undefined,
          document:
            replaySource.contentType === 'document' && replaySource.mediaId
              ? { id: replaySource.mediaId, mime_type: '' }
              : undefined,
          video:
            replaySource.contentType === 'video' && replaySource.mediaId
              ? { id: replaySource.mediaId, mime_type: '' }
              : undefined,
          context: undefined,
        },
        replayText(replaySource.contentText, cleanedText),
        contactRecord,
        conversation,
        accountId,
        userId,
        accessToken,
        phoneNumberId
      );
    }
  }

  // 1.7. Calendar scheduling intercept — voice notes and scheduling
  // texts ("remind me...", "site visit tomorrow 4pm", "today") go to
  // the calendar, but never while a draft session is mid-flight so
  // intake corrections aren't hijacked. tryHandleOwnerScheduling has
  // its own strict pre-filter and returns false for anything that
  // should continue into the intake flows below.
  //
  // The exception is a message that declares itself a task list and
  // then numbers the tasks. That is not a correction to a listing, and
  // treating it as one is how the first misroute became permanent: the
  // draft it wrongly opened swallowed the next task list as an edit and
  // refreshed its own timeout doing so, so it never expired and no
  // later list ever reached the calendar. The draft itself is left
  // alone — a half-built listing is still wanted, it just isn't what
  // this message is about.
  //
  // A voice note is the other exception, for the same reason and one
  // more: nobody forwards a listing by speaking it into their own
  // Engine number, so there is no correction to hijack — and a draft
  // left open from an hour ago used to swallow the whole recording
  // without a word back. The parser returns 'none' for a spoken
  // correction, which falls through to the draft below untouched.
  if (!isInteractiveTap && ((!propSession && !contactSession) || isDictatedTaskList(cleanedText) || isAudioMsg)) {
    try {
      const scheduled = await tryHandleOwnerScheduling({
        message,
        contentText: cleanedText || null,
        contactRecord,
        conversation,
        accountId,
        userId,
        accessToken,
        phoneNumberId,
      });
      if (scheduled) return true;
    } catch (err) {
      console.error('[chatbot-engine] scheduling intercept failed, falling through to intake:', err);
    }
  }

  // 1.8. Quick Task Switch / Fresh Ingestion Intercept
  const hasContactKeywords = cleanedText && (
    /is interested in|referred by|magicbricks|99acres|housing\.com/i.test(cleanedText) ||
    (cleanedText.split('\n').length >= 2 && /\b\d{10,15}\b/.test(cleanedText))
  );

  // A card arriving mid-listing is a person to file, never a correction
  // to the draft — and the draft would otherwise swallow it, because
  // the keyword test below never matches a card's rendered text.
  if (propSession && isContactCardMsg) {
    console.log(`[chatbot-engine] Discarding active property session ${propSession.id} for a shared contact card`);
    await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
    propSession = null;
  }

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
      } else if (imgClass === 'client_reply') {
        // A client's status reply is context to log, not contact
        // enrichment — handle it and leave the draft in flight.
        return await runClientReplyCapture();
      }
    } catch (err) {
      // On a classify/download failure, keep the contact session so the
      // image is treated as enrichment rather than silently lost.
      console.error('[chatbot-engine] Error classifying image during active contact session:', err);
    }
  } else if (contactSession && cleanedText) {
    const isNewContactForward = /is interested in|referred by|magicbricks|99acres|housing\.com/i.test(cleanedText);
    // A buyer requirement for the contact being drafted ("Requirements - ...",
    // "looking for a 2BHK plot in HSR") states what they WANT and must merge
    // into their requirements — never spin up a property listing, even though
    // it mentions sqft/plot/BHK/localities.
    const isBuyerRequirement = looksLikeBuyerRequirement(cleanedText);
    const isPropertyListing =
      !isBuyerRequirement &&
      /\b(bhk|sqft|flat|plot|villa|crore|lakh|price)\b/i.test(cleanedText) &&
      cleanedText.length > 50;

    if (isNewContactForward || isPropertyListing) {
      if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const classification = await classifyImageOrText(cleanedText, undefined, undefined);
      if (classification === 'property' && !isBuyerRequirement) {
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
        const normalizedPhone = ownerPhone ? (normalizePhoneWithCountryCode(ownerPhone) || null) : null;

        if (normalizedPhone) {
          const cleanPhone = normalizedPhone.replace(/\D/g, '');
          const { data: existingContacts } = await supabaseAdmin()
            .from('contacts')
            .select('id, name, classification')
            .eq('account_id', accountId)
            .or(`phone.eq."${String(ownerPhone).replace(/[\\"]/g, '\\$&')}",phone.eq.${normalizedPhone},phone.eq.${cleanPhone}`);

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
                name_tag: draft.owner_contact_name_tag?.trim() || null,
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

      // Four floor plans forwarded from one tower used to become four
      // unrelated listings, each repeating the project name as text and
      // none of them counted in it. The name is in the message; if the
      // account already tracks a project by it, this is a unit of that
      // project. Never creates one — naming a tower in passing is not a
      // decision to track it.
      const intakeProjectId = await matchProjectByName(
        supabaseAdmin(),
        accountId,
        draft.project,
      );

      // Create new property in inventory
      const { data: prop, error: propErr } = await supabaseAdmin()
        .from('properties')
        .insert({
          account_id: accountId,
          user_id: userId,
          project: draft.project?.trim() || null,
          project_id: intakeProjectId,
          title: draft.title!.trim(),
          description: draft.description || '',
          price: draft.listing_type === 'Rent' ? parsedRent : parsedPriceVal,
          price_per_sqft: parseNumeric(draft.price_per_sqft),
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
          documents: draft.documents || [],
          video_url: draft.video_url || null,
          video_status: draft.video_url ? 'ready' : null,
          youtube_video_id: draft.youtube_video_id || null,
          youtube_status: draft.youtube_video_id ? 'ready' : null,
          rental_income: parseNumeric(draft.rental_income),
          roi: parseNumeric(draft.roi),
          floor_tenancies: sanitizeFloorTenancies(draft.floor_tenancies),
          floor_plans: sanitizeFloorPlans(draft.floor_plans),
          google_map_link: draft.google_map_link,
          latitude: draft.latitude ?? null,
          longitude: draft.longitude ?? null,
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
          jv_structure: draft.jv_structure || null,
          owner_share_percent: parseNumeric(draft.owner_share_percent),
          builder_share_percent: parseNumeric(draft.builder_share_percent),
          goodwill_amount: parseNumeric(draft.goodwill_amount),
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
        // Forwarded walkthrough video → unlisted YouTube copy, when a
        // channel is connected (never throws; fire-and-forget). A
        // YouTube link shared during intake is already published —
        // re-uploading the MP4 would overwrite that ID with an
        // unlisted duplicate.
        if (draft.video_url && !draft.youtube_video_id) {
          void queueYouTubeUploadIfConnected(prop.id, accountId);
        }
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
        dealHeadline(prop) +
        `*Location:* ${prop.location}\n` +
        `*Type:* ${prop.type}\n` +
        (prop.land_area ? `*Land Area:* ${prop.land_area} ${prop.land_area_unit || 'Sq.Ft.'}\n` : '') +
        (prop.video_url || prop.youtube_video_id ? `*Video:* Attached 🎬\n` : '');

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
      // Lets a quote-reply on this card edit the listing (migration 185).
      await recordBotTarget({
        accountId,
        waMessageId: sendRes.messageId,
        entityType: 'property',
        entityId: prop.id,
      });
      return true;
    }

    // Handle image upload inside active session
    if (message.type === 'image' && message.image?.id) {
      // Ack with a ⏳ reaction on the photo itself (no chat bubble per
      // photo) and touch the session so pending preview threads yield —
      // an album ends as ONE confirmation card, not one per photo.
      await reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '⏳');
      await touchDraftSession(propSession.id);

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

        // Flip the ⏳ to ✅ on the user's photo — the only per-photo ack.
        void reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '✅');

        sendPropertyDraftPreviewDebounced(
          propSession.id,
          savedTime,
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📸 *Photos added successfully!* Total photos attached: *${updatedDraft.images.length}*.`,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error processing photo upload:', err);
        const reply = "❌ *Failed to upload image.* Please verify the photo format and try again.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        // Our arrival touch may have silenced an earlier thread's card —
        // fire a recovery preview so the album still ends with one card.
        sendPropertyDraftPreviewDebounced(
          propSession.id,
          new Date().toISOString(),
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          '📝 *Draft Listing:*',
          conversation.id
        );
        return true;
      }
    }

    // Handle walkthrough video inside active session — same ack
    // pattern as photos. A listing carries ONE video (properties.
    // video_url), so a second video replaces the first. Confirming the
    // draft stamps it onto the property and (when a YouTube channel is
    // connected) queues the unlisted YouTube upload.
    if (isVideoMsg) {
      await reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '⏳');
      await touchDraftSession(propSession.id);

      try {
        const { buffer, mimeType } = await loadInboundMedia();
        if (!mimeType?.includes('mp4')) {
          const reply = "⚠️ *Video format not supported.* Please send the walkthrough as an MP4 video.";
          const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
          await saveBotMessage(conversation.id, reply, sendRes.messageId);
          return true;
        }
        const publicUrl = await uploadPropertyVideo(accountId, buffer!, mimeType);

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
              console.log('[chatbot-engine] Active session was deleted concurrently. Exiting video upload flow.');
              return true;
            }
            throw fetchErr || new Error('Session not found during video append retry');
          }

          const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
          updatedDraft = { ...currentDraft, video_url: publicUrl };

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
          throw new Error('Failed to update draft session due to concurrent modifications');
        }

        const savedTime = finalUpdateData[0].updated_at;

        void reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '✅');

        sendPropertyDraftPreviewDebounced(
          propSession.id,
          savedTime,
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `🎬 *Video attached!* It will be added to the listing when you confirm.`,
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error processing video upload:', err);
        const reply = "❌ *Failed to upload video.* Please make sure it's an MP4 under 16MB and try again.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        sendPropertyDraftPreviewDebounced(
          propSession.id,
          new Date().toISOString(),
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          '📝 *Draft Listing:*',
          conversation.id
        );
        return true;
      }
    }

    // Handle document upload inside active session
    if (message.type === 'document' && message.document?.id) {
      // Same lightweight ack pattern as photos: react + touch, no
      // per-document chat bubble.
      await reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '⏳');
      await touchDraftSession(propSession.id);

      try {
        const { buffer, mimeType } = await loadInboundMedia();
        const filename = message.document.filename || `doc-${Date.now()}`;
        // Too large to keep is not too large to read: the contents are
        // extracted below either way, and the reply says which half landed.
        const stored = await storeBrochureDocument(accountId, buffer!, mimeType!, filename);
        const publicUrl = stored.url;

        // A brochure sent into an open draft used to be filed and
        // nothing more, so its photos and floor plans stayed locked in
        // the PDF. Same treatment as one that opens a draft.
        const brochure =
          mimeType === 'application/pdf'
            ? await uploadBrochureImages(accountId, buffer!)
            : { photos: [], planCandidates: [] };

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
              console.log('[chatbot-engine] Active session was deleted concurrently. Exiting document upload flow.');
              return true;
            }
            throw fetchErr || new Error('Session not found during document append retry');
          }

          const currentDraft = latestSession.draft_data as ParsedPropertyDraft;
          const currentDocs = currentDraft.documents || [];
          const updatedDocs =
            !publicUrl || currentDocs.includes(publicUrl)
              ? currentDocs
              : [...currentDocs, publicUrl];

          const { plans, unused } = pinBrochurePlans(
            currentDraft.floor_plans,
            brochure.planCandidates
          );
          const mergedImages = Array.from(
            new Set([...(currentDraft.images || []), ...brochure.photos, ...unused])
          );

          updatedDraft = {
            ...currentDraft,
            documents: updatedDocs,
            images: mergedImages,
            floor_plans: plans.length > 0 ? plans : currentDraft.floor_plans ?? null,
          };

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

        void reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '✅');

        sendPropertyDraftPreviewDebounced(
          propSession.id,
          savedTime,
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          `📄 *Documents added successfully!* Total documents attached: *${(updatedDraft.documents || []).length}*.` +
            brochureDroppedNote(stored.droppedBytes),
          conversation.id
        );
        return true;
      } catch (err) {
        console.error('[chatbot-engine] Error processing document upload:', err);
        // An oversize file says so, with its size: "try again" is advice
        // that cannot work, and the sender has no way to guess the cap.
        const reply =
          err instanceof DocumentTooLargeError
            ? `❌ *That document is too large.* ${err.message} Send a compressed copy, or split it.`
            : "❌ *Failed to upload document.* Please try again.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        sendPropertyDraftPreviewDebounced(
          propSession.id,
          new Date().toISOString(),
          phoneNumberId,
          accessToken,
          contactRecord.phone,
          '📝 *Draft Listing:*',
          conversation.id
        );
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
        // Same rule as fresh intake: a card re-forwarded into an open
        // draft still states the person's name outright, and the model
        // guesses at it just as readily on this path as on that one.
        updatedDraft = applySharedCardOwner(updatedDraft, cleanedText);
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

      // A card shared into an open draft is still a person shared. File
      // them here too, or an agent who forwards the card a second time
      // loses them the moment they tap Cancel.
      const cardFiled =
        parseSharedContactCards(cleanedText).length > 0 && updatedDraft.owner_contact_name
          ? await fileSharedCardContact({
              accountId,
              userId,
              owner: {
                name: updatedDraft.owner_contact_name,
                nameTag: updatedDraft.owner_contact_name_tag ?? null,
                phone: updatedDraft.owner_contact_phone,
              },
              role: updatedDraft.owner_contact_role,
            })
          : null;

      sendPropertyDraftPreviewDebounced(
        propSession.id,
        actualSavedTime,
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        cardFiled?.created
          ? `📝 *Draft Listing Updated:*\n👤 _Saved ${cardFiled.name} to Contacts._`
          : `📝 *Draft Listing Updated:*`,
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

    // Accepting the suggested contact: take their number onto the draft.
    //
    // The id carries the contact, so the tap means "this person" rather
    // than "whatever the matcher recomputes now" — the book can change
    // between the card being sent and the button being pressed, and an
    // agent who read a name should get the person they read.
    if (buttonId?.startsWith('link_contact:')) {
      const linkedId = buttonId.slice('link_contact:'.length);
      const { data: linked } = await supabaseAdmin()
        .from('contacts')
        .select('id, name, phone')
        .eq('id', linkedId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (!linked?.phone) {
        const reply = "⚠️ *That contact is no longer available.* Reply with the phone number instead.";
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }

      const target = (container.contacts || []).findIndex((c) => !(c.phone || '').trim());
      const linkedContainer: ParsedContactDraftsContainer = {
        contacts: (container.contacts || []).map((c, i) =>
          i === target ? { ...c, phone: linked.phone as string } : c
        ),
      };
      const { isValid, missingFields } = validateContactDraftsContainer(linkedContainer);
      const nextStatus = isValid ? 'awaiting_confirmation' : 'collecting';

      await supabaseAdmin()
        .from('contact_draft_sessions')
        .update({
          draft_data: linkedContainer,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactSession.id);

      await sendContactDraftPreview(
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `🔗 *Linked to ${linked.name} — confirm to update them:*`,
        linkedContainer,
        nextStatus,
        missingFields,
        conversation.id,
        accountId
      );
      return true;
    }

    // Handle CONFIRM instruction
    if (buttonId === 'confirm_contact' || lowerText === 'confirm') {
      const confirmedContainer = await resolveExactContactLinks(container, accountId);
      const { isValid, missingFields } = validateContactDraftsContainer(confirmedContainer);
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
      const enriched: { id: string; name: string; changed: string[] }[] = [];

      for (const draft of confirmedContainer.contacts) {
        const normalized = normalizePhoneWithCountryCode(draft.phone || '');
        const cleanPhone = normalized.replace(/\D/g, '');
        const { data: existingContact } = await supabaseAdmin()
          .from('contacts')
          .select('id, name')
          .eq('account_id', accountId)
          .or(`phone.eq."${String(draft.phone).replace(/[\\"]/g, '\\$&')}",phone.eq.${normalized},phone.eq.${cleanPhone}`)
          .maybeSingle();

        if (existingContact) {
          // Enrich rather than skip. A forwarded chat about someone we
          // already know is the normal case, not a mistake — and this
          // answered it with "skipped duplicate", throwing away every
          // requirement and budget the conversation carried. Additive
          // only: an agent's own edits outrank an extraction.
          const { data: held } = await supabaseAdmin()
            .from('contacts')
            .select('email, company, name_tag, requirements')
            .eq('id', existingContact.id)
            .maybeSingle();
          const enrichment = enrichmentFor(draft, held || {});
          if (enrichment.changed.length === 0) {
            duplicates.push(`${existingContact.name} (${normalized || draft.phone})`);
          } else {
            const patch: Record<string, string> = { ...enrichment.updates };
            if (enrichment.requirements) patch.requirements = enrichment.requirements;
            const { error: enrichErr } = await supabaseAdmin()
              .from('contacts')
              .update(patch)
              .eq('id', existingContact.id)
              .eq('account_id', accountId);
            if (enrichErr) {
              console.error('[chatbot-engine] contact enrichment failed:', enrichErr);
              duplicates.push(`${existingContact.name} (${normalized || draft.phone})`);
            } else {
              // Budget, areas and BHK live in pref_*, which the matcher
              // reads; the requirements free text is invisible to it.
              await syncContactPreferences(supabaseAdmin(), accountId, existingContact.id);
              enriched.push({
                id: existingContact.id,
                name: String(existingContact.name),
                changed: enrichment.changed,
              });
            }
          }
        } else {
          // Resolve referrer if present
          let referrerContactId = null;
          let referrerNameText = draft.referrer_name || null;

          if (draft.referrer_name) {
            const refName = draft.referrer_name.trim();
            const refPhone = draft.referrer_phone;
            let refQuery = supabaseAdmin().from('contacts').select('id, name').eq('account_id', accountId);
            
            if (refPhone) {
              const refNormalized = normalizePhoneWithCountryCode(refPhone);
              const refCleanPhone = refNormalized.replace(/\D/g, '');
              const escapedRefName = refName.replace(/[\\"]/g, '\\$&');
              refQuery = refQuery.or(`phone.eq."${String(refPhone).replace(/[\\"]/g, '\\$&')}",phone.eq.${refNormalized},phone.eq.${refCleanPhone},name.ilike."${escapedRefName}"`);
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

          // Phonebook-style names ("Nataraj Bank DSA") get the qualifier moved
          // into the Engine-only Name Tag so outbound messages stay clean.
          const nameSplit = suggestNameTagSplit(draft.name!.trim());
          toInsert.push({
            account_id: accountId,
            user_id: userId,
            name: nameSplit?.name ?? draft.name!.trim(),
            name_tag: draft.name_tag?.trim() || nameSplit?.nameTag || null,
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
        // An enriched contact is the SUCCESS case of a forwarded chat
        // about someone we already know, so it must not be reported
        // under a warning about duplicates.
        const reply = enriched.length > 0
          ? `✅ *Updated ${enriched.length} existing contact(s) in ${BRANDING.name}!*\n\n` +
            enriched.map(e => `• *${e.name}* — ${e.changed.join(', ')} updated`).join('\n') +
            (duplicates.length > 0
              ? `\n\n⚠️ *Nothing new for:* \n` + duplicates.map(d => `• ${d}`).join('\n')
              : '') +
            (enriched.length === 1
              ? `\n\nView in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts?contactId=${enriched[0].id}`
              : '')
          : `⚠️ *All contacts already exist in ${BRANDING.name}:* \n` +
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

      // Create new contacts in the Engine
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
              // Only a project name earns a tag. A property_code is an
              // internal SKU and a chopped-up title is a listing, not a
              // segment — both filled the tag picker with rows nobody
              // could ever broadcast to.
              const tagName =
                matchedProp.project && matchedProp.project.trim().length >= 3
                  ? matchedProp.project.trim()
                  : '';

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
        .filter((c: Contact) => c.phone && notesMap[c.phone])
        .map((c: Contact) => ({
          contact_id: c.id,
          user_id: userId,
          account_id: accountId,
          note_text: notesMap[c.phone!]!.trim(),
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

      let reply = `✅ *Successfully saved ${inserted.length} new contact(s) to ${BRANDING.name}!*\n\n`;
      inserted.forEach((c: Contact) => {
        const tagNote = c.name_tag ? ` — 🏷️ ${c.name_tag}` : '';
        reply += `• *Name:* ${c.name}${tagNote} (${c.phone}) [${c.classification}]\n`;
      });
      if (enriched.length > 0) {
        reply += `\n♻️ *Updated existing:* \n` +
          enriched.map(e => `• ${e.name} — ${e.changed.join(', ')}`).join('\n') + `\n`;
      }
      if (duplicates.length > 0) {
        reply += `\n⚠️ *Nothing new for:* \n` + duplicates.map(d => `• ${d}`).join('\n') + `\n`;
      }
      if (inserted.length === 1) {
        reply += `\nView in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts?contactId=${inserted[0].id}`;
      } else {
        reply += `\nView in dashboard: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/contacts`;
      }
        
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      // Only a single-contact card names one unambiguous row, so only
      // that one is quote-editable (migration 185).
      if (inserted.length === 1) {
        await recordBotTarget({
          accountId,
          waMessageId: sendRes.messageId,
          entityType: 'contact',
          entityId: inserted[0].id,
        });
      }
      return true;
    }


    // A new screenshot/card during an active contact draft either
    // enriches it or replaces it, and the card itself decides which.
    //
    // Merging used to be positional: incoming contact #1 backfilled
    // draft contact #1, so a different person's card grafted their
    // phone and email onto whoever was already in the draft. Replacing
    // unconditionally fixed that and broke the other half — two
    // screenshots of the same person stopped combining.
    //
    // reconcileContactDrafts asks whether every incoming contact is
    // someone already in the draft. All of them, and it merges against
    // the MATCHED contact rather than a shared index; one stranger and
    // the card is new business, so the old draft goes.
    if (isMediaMsg) {
      if (!(await gatedBurn(accountId, 'contact_parse'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      const analyzingMsg = "⏳ _Analyzing the card... Please wait._";
      const analyzingRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: analyzingMsg });
      await saveBotMessage(conversation.id, analyzingMsg, analyzingRes.messageId);

      try {
        const { buffer, mimeType } = await loadInboundMedia();
        const parsedIncoming = await parseContactFromImageOrText(contentText || '', buffer, mimeType);
        const { container: mergedContainer, replaced } = reconcileContactDrafts(
          container,
          parsedIncoming
        );
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
          replaced
            ? `📝 *New Contact Draft — previous one discarded:*`
            : `📝 *Contact Drafts Updated:*`,
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

    // A second card is another person, or the same one again — never a
    // correction to type over the draft. Reconciled the way a second
    // screenshot is, and free, because the card needs no reading.
    const incomingCards = isContactCardMsg ? contactDraftsFromCards(cleanedText) : null;
    if (incomingCards) {
      const { container: mergedContainer, replaced } = reconcileContactDrafts(container, incomingCards);
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
        replaced
          ? `📝 *New Contact Draft — previous one discarded:*`
          : `📝 *Contact Drafts Updated:*`,
        mergedContainer,
        nextStatus,
        missingFields,
        conversation.id,
        accountId
      );
      return true;
    }

    // Handle conversational updates to contact drafts
    if (cleanedText) {
      let updatedContainer = applyExplicitContactDraftUpdate(
        container,
        cleanedText
      );
      if (!updatedContainer) {
        if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
          return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
        }
        updatedContainer = await updateContactDraft(container, cleanedText);
      }
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
    // A bare video with no caption can't seed a draft (nothing to
    // parse) — the concurrency poll above already waited for a session
    // from accompanying text/photos, so leave it in the inbox.
    if (isVideoMsg && !cleanedText) {
      return false;
    }

    const { buffer: mediaBuffer, mimeType: mediaMimeType } = await loadInboundMedia();

    // A card and a document each decide themselves what they are, so
    // neither reaches the model — and neither is charged for a
    // classification that never ran.
    let classification: 'property' | 'contact' | 'schedule' | 'client_reply' | 'requirement' | 'none';
    if (isContactCardMsg) {
      classification = 'contact';
    } else if (isDocMsg) {
      classification = 'property';
    } else {
      if (!(await gatedBurn(accountId, 'chatbot_classify'))) {
        return await sendCreditsLockedReply(phoneNumberId, accessToken, contactRecord.phone, conversation.id);
      }
      classification = isVideoMsg
        // The classifier takes images/text, not video bytes — classify
        // from the caption alone.
        ? await classifyImageOrText(cleanedText, undefined, undefined)
        : await classifyImageOrText(cleanedText, mediaBuffer, mediaMimeType);
    }

    // --- SCHEDULING FLOW (screenshot of a chat that fixes a meeting) ---
    // The step 1.7 intercept deliberately passed on this image because it
    // had no buffer to read; now that the classifier has committed, hand
    // the bytes over. A false classification or an unparseable thread
    // returns false and falls through to the 'none' handling below.
    if (classification === 'schedule') {
      if (isImageMsg && mediaBuffer && mediaMimeType) {
        try {
          const scheduled = await tryHandleOwnerScheduling({
            message,
            image: { buffer: mediaBuffer, mimeType: mediaMimeType },
            contentText: cleanedText || null,
            contactRecord,
            conversation,
            accountId,
            userId,
            accessToken,
            phoneNumberId,
          });
          if (scheduled) return true;
        } catch (err) {
          console.error('[chatbot-engine] image scheduling failed:', err);
        }
      }
      classification = 'none';
    }

    // --- CLIENT REPLY / REQUIREMENT FLOW (forwarded chat: a client
    // responding on an already-shared listing, or saying what they are
    // hunting for — log it against them, don't draft a listing from
    // it) ---
    if (classification === 'client_reply' || classification === 'requirement') {
      return await runClientReplyCapture();
    }

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
        // Set when the brochure itself was past what storage will hold.
        // Its contents still made it in; the sender is told which half
        // was kept so a missing document is never a silent surprise.
        let droppedBrochureBytes: number | null = null;

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
          } else if (isVideoMsg) {
            // Video bytes don't go to Gemini — parse the caption text,
            // and upload the walkthrough in parallel (mp4 only; the
            // property-videos bucket rejects other formats).
            const [parsed, videoUrl] = await Promise.all([
              parseListingFromImageOrText(cleanedText),
              mediaMimeType.includes('mp4')
                ? uploadPropertyVideo(accountId, mediaBuffer, mediaMimeType)
                : Promise.resolve(null),
            ]);
            parsedDraft = parsed;
            parsedDraft.images = [];
            if (videoUrl) parsedDraft.video_url = videoUrl;
          } else if (mediaMimeType === 'application/pdf') {
            const filename = message.document?.filename || `doc-${Date.now()}.pdf`;
            // Parallel parse text details, extract images, and upload the PDF document itself
            const [parsed, brochure, stored] = await Promise.all([
              parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType),
              uploadBrochureImages(accountId, mediaBuffer),
              storeBrochureDocument(accountId, mediaBuffer, mediaMimeType, filename)
            ]);

            parsedDraft = parsed;
            // A brochure too big for storage still yields its details,
            // plans and photos; only the file is dropped, and the reply
            // says so.
            parsedDraft.documents = stored.url ? [stored.url] : [];
            droppedBrochureBytes = stored.droppedBytes;

            uploadedImages.push(...brochure.photos);
            parsedDraft.images = uploadedImages;

            // The parser names the floors; the extractor supplies the
            // drawings. Any drawing left over after every named floor
            // has one joins the gallery rather than being discarded.
            const { plans, unused } = pinBrochurePlans(parsedDraft.floor_plans, brochure.planCandidates);
            parsedDraft.floor_plans = plans;
            if (unused.length > 0) {
              uploadedImages.push(...unused);
              parsedDraft.images = uploadedImages;
            }
            console.log(
              `[chatbot-engine] PDF gave ${brochure.photos.length} photo(s) and ${brochure.planCandidates.length} plan drawing(s) across ${plans.length} floor(s).`
            );
          } else {
            // Other document types fallback
            const filename = message.document?.filename || `doc-${Date.now()}`;
            const [parsed, stored] = await Promise.all([
              parseListingFromImageOrText(contentText || '', mediaBuffer, mediaMimeType),
              storeBrochureDocument(accountId, mediaBuffer, mediaMimeType, filename)
            ]);
            parsedDraft = parsed;
            parsedDraft.images = [];
            parsedDraft.documents = stored.url ? [stored.url] : [];
            droppedBrochureBytes = stored.droppedBytes;
          }
        } else {
          parsedDraft = await parseListingFromImageOrText(cleanedText);
          parsedDraft.images = [];
        }

        // A forwarded contact card states the person's name outright,
        // so it wins over whichever word the model picked out of the
        // phonebook label it was reading. No-op for every other message.
        const fromSharedCard = parseSharedContactCards(cleanedText).length > 0;
        parsedDraft = applySharedCardOwner(parsedDraft, cleanedText);

        // A pin shared moments before this message was waiting for the
        // listing it belongs to. Applied before the backfill so the
        // geocoding runs once, on whichever link the draft ends up with.
        const pendingPin = await takePendingMapPin(accountId, contactRecord.id);
        if (pendingPin) {
          parsedDraft = applyPinToDraft(parsedDraft, pendingPin);
        }

        parsedDraft = await backfillLocationFromMapLink(parsedDraft);

        // The parse says what the classifier could not: a priceless
        // draft that calls itself a requirement is a buyer's brief,
        // and filing it as inventory puts demand in the supply book.
        // The parse is already paid for, so this costs nothing.
        if (draftReadsAsRequirement(parsedDraft, cleanedText)) {
          console.log('[chatbot-engine] Listing draft reads as a buyer requirement; capturing it against the client instead.');
          return await runClientReplyCapture();
        }

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
                  
                  mergedDraft = applyListingDerivations({
                    title: latestDraft.title || parsedDraft.title,
                    description: latestDraft.description || parsedDraft.description,
                    price: latestDraft.price || parsedDraft.price,
                    price_per_sqft: latestDraft.price_per_sqft || parsedDraft.price_per_sqft,
                    price_from_rate: latestDraft.price_from_rate || parsedDraft.price_from_rate,
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
                    latitude: latestDraft.latitude ?? parsedDraft.latitude,
                    longitude: latestDraft.longitude ?? parsedDraft.longitude,
                    geo_resolved_from: latestDraft.geo_resolved_from || parsedDraft.geo_resolved_from,
                    land_area: latestDraft.land_area || parsedDraft.land_area,
                    land_area_unit: latestDraft.land_area_unit || parsedDraft.land_area_unit,
                    rental_income: latestDraft.rental_income || parsedDraft.rental_income,
                    roi: latestDraft.roi || parsedDraft.roi,
                    floor_tenancies: latestDraft.floor_tenancies?.length
                      ? latestDraft.floor_tenancies
                      : parsedDraft.floor_tenancies || [],
                    owner_contact_name: latestDraft.owner_contact_name || parsedDraft.owner_contact_name,
                    owner_contact_phone: latestDraft.owner_contact_phone || parsedDraft.owner_contact_phone,
                    owner_contact_role: latestDraft.owner_contact_role || parsedDraft.owner_contact_role,
                    listing_type: latestDraft.listing_type || parsedDraft.listing_type,
                    rent_per_month: latestDraft.rent_per_month || parsedDraft.rent_per_month,
                    maintenance: latestDraft.maintenance || parsedDraft.maintenance,
                    advance: latestDraft.advance || parsedDraft.advance,
                    gst: latestDraft.gst || parsedDraft.gst,
                    jv_structure: latestDraft.jv_structure || parsedDraft.jv_structure,
                    owner_share_percent: latestDraft.owner_share_percent || parsedDraft.owner_share_percent,
                    builder_share_percent: latestDraft.builder_share_percent || parsedDraft.builder_share_percent,
                    goodwill_amount: latestDraft.goodwill_amount || parsedDraft.goodwill_amount,
                    video_url: latestDraft.video_url || parsedDraft.video_url,
                    youtube_video_id: latestDraft.youtube_video_id || parsedDraft.youtube_video_id,
                    features: Array.from(new Set([...(latestDraft.features || []), ...(parsedDraft.features || [])])),
                    nearby_highlights: Array.from(new Set([...(latestDraft.nearby_highlights || []), ...(parsedDraft.nearby_highlights || [])])),
                    images: Array.from(new Set([...(latestDraft.images || []), ...(parsedDraft.images || [])])),
                    documents: Array.from(new Set([...(latestDraft.documents || []), ...(parsedDraft.documents || [])]))
                  });

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
                  `📝 *Listing details and photos merged into draft!*` + brochureDroppedNote(droppedBrochureBytes),
                  conversation.id
                );
                return true;
              }
            }
          }
          throw insertErr;
        }

        if (!insertErr && insertedData && insertedData.length > 0) {
          // Someone who shares a contact card has shared a person, and
          // the listing draft they also described may never be
          // confirmed. File them now rather than losing them with it.
          const filedContact = fromSharedCard && parsedDraft.owner_contact_name
            ? await fileSharedCardContact({
                accountId,
                userId,
                owner: {
                  name: parsedDraft.owner_contact_name,
                  nameTag: parsedDraft.owner_contact_name_tag ?? null,
                  phone: parsedDraft.owner_contact_phone,
                },
                role: parsedDraft.owner_contact_role,
              })
            : null;

          const savedTime = insertedData[0].updated_at;
          sendPropertyDraftPreviewDebounced(
            insertedData[0].id,
            savedTime,
            phoneNumberId,
            accessToken,
            contactRecord.phone,
            (filedContact?.created
              ? `📝 *Draft Property Listing Created!*\n👤 _Saved ${filedContact.name} to Contacts._`
              : `📝 *Draft Property Listing Created!*`) + brochureDroppedNote(droppedBrochureBytes),
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
      // A card needs no reading: the name and the number are stated on
      // it. Skip the parse, its charge, and the "Analyzing…" wait.
      const cardContainer = isContactCardMsg ? contactDraftsFromCards(cleanedText) : null;

      if (!cardContainer) {
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
      }

      try {
        let parsedContainer: ParsedContactDraftsContainer;

        if (cardContainer) {
          parsedContainer = cardContainer;
        } else if (isMediaMsg && mediaBuffer && mediaMimeType) {
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

    // --- MAP PIN AHEAD OF ITS LISTING ---
    // A shared pin carries no listing and no person, so it lands here as
    // 'none'. It is not noise: the details follow it seconds later, and
    // answering "I couldn't tell what that was" threw away the most
    // precise thing the lister had. Hold it for the next draft instead.
    if (classification === 'none' && !isMediaMsg) {
      const mapLink = extractMapLinkFromText(cleanedText);
      if (mapLink) {
        const pin = await parkMapPin({
          accountId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          mapLink,
        });
        const reply = buildPinParkedMessage(pin);
        const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
        await saveBotMessage(conversation.id, reply, sendRes.messageId);
        return true;
      }
    }
  }

  // Handle help command or general welcome instructions.
  // Skip if this is an interactive reply — those belong to the flow
  // engine — or a template quick-reply tap (message.type 'button',
  // e.g. a reminder's "Fine"): answering a button tap with the
  // welcome text reads as a non-sequitur.
  if (!buttonId && message.type !== 'button' && (isOwnerHelpCommand(lowerText) || cleanedText)) {
    // An explicit "help"/greeting wants the whole capability guide;
    // anything else got here because it classified as neither a listing
    // nor a contact, and is better served by a short nudge.
    const reply = isOwnerHelpCommand(lowerText)
      ? buildOwnerHelpMessage()
      : buildOwnerFallbackMessage(spokenText || null);

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
  const admin = supabaseAdmin();
  const [settings, account] = await Promise.all([
    admin
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', accountId)
      .maybeSingle(),
    admin.from('accounts').select('name').eq('id', accountId).maybeSingle(),
  ]);
  return {
    phone: settings.data?.contact_phone ?? '',
    businessName: account.data?.name ?? '',
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
 * external agent/property owner (NOT Engine staff) drafting a listing via
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
      type: 'button_reply' | 'list_reply' | 'nfm_reply';
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
      nfm_reply?: { name?: string; body?: string; response_json: string };
    };
  },
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string },
  conversation: { id: string },
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

  // Session Expiry Timeout (an hour of inactivity) — mirrors the owner flow.
  const updatedAt = new Date(propSession.updated_at).getTime();
  if (Date.now() - updatedAt > DRAFT_SESSION_TIMEOUT_MS) {
    console.log(`[chatbot-engine] Expiring inactive external listing session ${propSession.id}`);
    await supabaseAdmin().from('property_draft_sessions').delete().eq('id', propSession.id);
    
    // If this is a template button tap (e.g. "Tell me more" on a digest),
    // silently expire the session and fall through. Sending an expiration
    // warning while ignoring their tap is confusing, and they didn't
    // initiate this interaction to talk about their draft anyway.
    if (message.type === 'button') {
      return false;
    }

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

    // Same project rule as the owner path: a submission naming a tower
    // the account already tracks is a unit of it. This one lands as
    // Pending Review either way, so a wrong link is caught by the same
    // human who is already checking the price.
    const listerProjectId = await matchProjectByName(
      supabaseAdmin(),
      accountId,
      draft.project,
    );

    // Self-listing: the WhatsApp sender IS the owner/agent of this
    // property. Never look up or create another contact for it —
    // that's what the "never invoke contact creation" rule is about.
    const { data: prop, error: propErr } = await supabaseAdmin()
      .from('properties')
      .insert({
        account_id: accountId,
        user_id: null,
        project: draft.project?.trim() || null,
        project_id: listerProjectId,
        title: draft.title!.trim(),
        description: draft.description || `Submitted via WhatsApp by an external lister, pending review.`,
        price: draft.listing_type === 'Rent' ? (draft.rent_per_month || 0) : (draft.price || 0),
        price_per_sqft: draft.price_per_sqft ?? null,
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
        documents: draft.documents || [],
        youtube_video_id: draft.youtube_video_id || null,
        youtube_status: draft.youtube_video_id ? 'ready' : null,
        rental_income: draft.rental_income,
        roi: draft.roi,
        floor_tenancies: sanitizeFloorTenancies(draft.floor_tenancies),
        floor_plans: sanitizeFloorPlans(draft.floor_plans),
        google_map_link: draft.google_map_link,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        land_area: draft.land_area,
        land_area_unit: draft.land_area_unit || 'Sq.Ft.',
        owner_contact_id: contactRecord.id,
        listing_source: 'whatsapp_lister',
        listing_type: draft.listing_type || 'Sale',
        rent_per_month: draft.rent_per_month,
        maintenance: draft.maintenance,
        advance: draft.advance,
        gst: draft.gst,
        jv_structure: draft.jv_structure || null,
        owner_share_percent: draft.owner_share_percent ?? null,
        builder_share_percent: draft.builder_share_percent ?? null,
        goodwill_amount: draft.goodwill_amount ?? null,
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

    let requirementRef: string | null = null;
    if (propSession.requirement_link_id) {
      requirementRef = await recordRequirementResponse(supabaseAdmin(), propSession.requirement_link_id, {
        propertyCode: prop.property_code,
        title: prop.title,
      });
    }

    let reply = `✅ *Thanks! Your property listing has been submitted.*\n\n` +
      `*Code:* ${prop.property_code}\n` +
      `*Title:* ${prop.title}\n` +
      dealHeadline(prop) +
      `*Location:* ${prop.location}\n` +
      `*Type:* ${prop.type}\n`;

    if (prop.features && prop.features.length > 0) {
      reply += `*Amenities:* ${prop.features.join(', ')}\n`;
    }
    if (prop.nearby_highlights && prop.nearby_highlights.length > 0) {
      reply += `*Nearby Highlights:* ${prop.nearby_highlights.join(', ')}\n`;
    }
    if (requirementRef) {
      reply += `🤝 *Responding to:* requirement ${requirementRef}\n`;
    }

    reply += `\n🕐 *Pending review* — our team will verify the details and publish it shortly.`;

    const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
    await saveBotMessage(conversation.id, reply, sendRes.messageId);
    return true;
  }

  // Handle image upload inside active session
  if (message.type === 'image' && message.image?.id) {
    // React + touch instead of a per-photo chat bubble — see the owner
    // intake image branch for the full rationale.
    await reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '⏳');
    await touchDraftSession(propSession.id);

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

      void reactToInboundMessage(phoneNumberId, accessToken, contactRecord.phone, message.id, '✅');

      sendPropertyDraftPreviewDebounced(
        propSession.id,
        savedTime,
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        `📸 *Photos added successfully!* Total photos attached: *${updatedDraft.images.length}*.`,
        conversation.id
      );
      return true;
    } catch (err) {
      console.error('[chatbot-engine] Error processing external listing photo upload:', err);
      const reply = "❌ *Failed to upload image.* Please verify the photo format and try again.";
      const sendRes = await sendTextMessage({ phoneNumberId, accessToken, to: contactRecord.phone, text: reply });
      await saveBotMessage(conversation.id, reply, sendRes.messageId);
      sendPropertyDraftPreviewDebounced(
        propSession.id,
        new Date().toISOString(),
        phoneNumberId,
        accessToken,
        contactRecord.phone,
        '📝 *Draft Listing:*',
        conversation.id
      );
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
