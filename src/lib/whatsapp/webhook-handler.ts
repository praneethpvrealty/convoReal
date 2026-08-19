Warning: truncated output (original token count: 39612)
Total output lines: 4538

import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveConversation, type ConversationRow } from '@/lib/conversations/resolve'
import { markContactDead } from '@/lib/contacts/lifecycle'
import { DELIVERY_FAILURE_MARKER } from '@/lib/whatsapp/delivery-failure'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch, normalizePhoneWithCountryCode, sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { BRANDING } from '@/config/branding'
import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import {
  isGroupWebhookField,
  processGroupWebhook,
} from '@/lib/whatsapp/group-webhooks'
import {
  groupIdFromInbound,
  resolveGroupSender,
  resolveGroupThread,
} from '@/lib/whatsapp/group-inbound'
import { checkIsAccountOwner, processOwnerChatbotMessage, processExternalListingMessage } from '@/lib/ai/chatbot-engine'
import { processBuyerQualificationMessage } from '@/lib/ai/buyer-qualification'
import {
  applyPreferenceFlowResponse,
  sendPreferenceFlowToContact,
  getPublishedPreferenceFlow,
} from '@/lib/whatsapp/meta-flow-service'
import { sendPreferenceMatchFollowUp } from '@/lib/whatsapp/preference-match-followup'
import { sendPreferenceTapReply } from '@/lib/whatsapp/preference-tap-reply'
import {
  handleListingFeedbackReply,
  LISTING_FEEDBACK_ID_PREFIX,
  sendListingFeedbackPrompt,
} from '@/lib/whatsapp/listing-feedback'
import {
  budgetBandAcknowledgement,
  handleBudgetBandReply,
  BUDGET_BAND_ID_PREFIX,
} from '@/lib/whatsapp/budget-band'
import {
  propertyTypeAcknowledgement,
  handlePropertyTypeReply,
  PROPERTY_TYPE_ID_PREFIX,
} from '@/lib/whatsapp/property-type-prompt'
import { sendAlertsOnboarding } from '@/lib/whatsapp/alerts-onboarding'
import {
  handleRequirementTweakReply,
  REQUIREMENT_TWEAK_ID_PREFIX,
} from '@/lib/whatsapp/requirement-review'
import {
  isPreferenceFlowRequestText,
  parsePreferenceFormValues,
  preferenceFormToContactUpdate,
  summarizePreferenceUpdate,
  PREFERENCE_FLOW_BUTTON_ID,
} from '@/lib/whatsapp/preference-flow'
import { JOURNEY_CHECKIN_KEEP_BUTTON } from '@/lib/whatsapp/journey-checkin-template'
import {
  CLIENT_FOLLOWUP_PREFIX,
  handleClientFollowupReply,
  handleInboxCheckinReply,
  handleTimelineTemplateTap,
} from '@/lib/journey/client-response'
// The per-template CLOSE_BUTTON constants are gone from here on
// purpose: matchTemplateButton resolves a tap to its action in any
// language we send, and comparing against one English string again
// would silently stop working for every translated template.
import { matchTemplateButton } from '@/lib/whatsapp/template-copy'
import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url'
import type { Contact } from '@/types'
import {
  hasRecentAgentReply,
  standDownActiveFlowRuns,
} from '@/lib/whatsapp/agent-takeover'
import { claimBuyerConsentAsk } from '@/lib/buyer/consent-ask'
import {
  claimOwnerConsentAsk,
  CONSENT_BUTTONS as OWNER_CONSENT_BUTTONS,
  type OwnerConsentFields,
} from '@/lib/owners/consent-ask'
import {
  answerLeadQuestion,
  looksLikeQuestion,
  mergeLeadAnswers,
  questionSubjectProperties,
  requestsHumanContact,
  subjectPortalListings,
  type LeadAnswer,
} from '@/lib/ai/lead-question'
import {
  photoHandoverText,
  requestsPropertyPhotos,
  sendSubjectPhotos,
} from '@/lib/ai/photo-request'
import { parseOrdinalReferences } from '@/lib/ai/shortlist-reference'
import {
  buildEnquiryAckText,
  buildEnquiryRejectText,
  parseEnquiryReply,
  resolveEnquiryTeamPhone,
  sendPropertyEnquiryCard,
} from '@/lib/whatsapp/enquiry-card'
import { maybeAutoHeatContact } from '@/lib/contacts/auto-heat'
import {
  handleFollowUpReply,
  parseFollowUpReply,
} from '@/lib/contacts/follow-up-nudges'
import {
  handleClosingReply,
  handlePurchaseProgressReply,
  parseClosingReply,
} from '@/lib/journey/closing-nudges'
import {
  parseTemplateQuickReply,
  lastSharedPropertyId,
  buildFullListMessage,
  DETAILS_FALLBACK_TEXT,
  SITE_VISIT_ACK_TEXT,
} from '@/lib/whatsapp/template-quick-replies'
import {
  parseOwnerDigestCommand,
  applyOwnerDigestCommand,
} from '@/lib/owners/owner-digest'
import {
  parseBuyerAlertsCommand,
  applyBuyerAlertsCommand,
} from '@/lib/buyer/alerts'
import { isLocationGuarded } from '@/lib/inventory/location-guard'
import {
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
  handleLocationConsentReply,
  handleOwnerLocationReply,
} from '@/lib/inventory/location-requests'
import { isEngineControlReplyId } from '@/lib/whatsapp/control-reply-ids'
import { UPDATE_CHANNEL_REPLY_PREFIX } from '@/lib/voice/announcements'
import { handleUpdateChannelReply } from '@/lib/voice/update-channel-reply'
import {
  POST_CALL_OPEN_PREFIX,
  handlePostCallOpenReply,
} from '@/lib/outreach/dispatcher'
import { parseBuyerMatchesCommand } from '@/lib/buyer/digest'
import { buildBuyerMatchReply } from '@/lib/buyer/match-reply'
import {
  isOwnerContact,
  findOwnedListings,
  handleOwnerInboundMessage,
  type OwnedListing,
} from '@/lib/owners/owner-reply'
import { processListingVerification } from '@/lib/showcase/listing-verification'
import { processRequirementReply } from '@/lib/requirements/respond'
import { tryHandleInboundScheduling } from '@/lib/calendar/whatsapp-scheduler'
import {
  AGENT_MESSAGE_CONTACT_PREFIX,
  handleAgentMessageContactReply,
} from '@/lib/calendar/agent-reminder-actions'
import { createNotification } from '@/lib/notifications/create'
import { processCtwaReferral, type WhatsAppReferral } from '@/lib/whatsapp/ctwa-attribution'
import { resolveRouting } from '@/lib/whatsapp/routing-engine'
import {
  handleBridgedAgentReply,
  relayLeadMessageToBridgedAgent,
  BRIDGE_REPLY_HINT,
} from '@/lib/whatsapp/reply-bridge'
import { SHARED_CARDS_HEADER } from '@/lib/contacts/shared-cards'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { googleMapsUrlForCoordinates } from '@/lib/maps/resolve-location'
import { getSandboxSystemConfig } from '@/lib/system-settings'
import {
  isSandboxTrialExpired,
  releaseSandboxSender,
  type SandboxTenantConfig,
} from '@/lib/whatsapp/sandbox-trial'
import type { SandboxSenderMapping } from '@/types'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  buildSoldPriceReply,
  SOLD_PRICE_BUTTON_PREFIX,
  SOLD_SIMILAR_BUTTON_PREFIX,
} from '@/lib/whatsapp/sold-notification'
import {
  buildCatalogOrderMessage,
  buildPropertyInterestAck,
  buildPropertyInterestQuestion,
  buildUnresolvedPropertyInterestAck,
  isDirectPropertyInterest,
  resolvePropertyReference,
  type PropertyInterestCandidate,
  type WhatsAppCatalogOrder,
} from '@/lib/whatsapp/property-interest'
import { logPropertyShare } from '@/lib/whatsapp/share-property-send'

export interface WhatsAppMessage {
  id: string
  /** The PARTICIPANT's phone on a group message, not the group. */
  from: string
  /** Present only on group messages. Its absence is what marks an
   *  inbound as an ordinary one-to-one. */
  group_id?: string | null
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  button?: { text: string; payload: string }
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string }
    phones?: Array<{ phone: string; type?: string; wa_id?: string }>
    emails?: Array<{ email: string; type?: string }>
    vcard: string
  }>
  /** A property selected from the WhatsApp Commerce catalog. Meta calls
   *  this an order even when the customer is only sharing one listing. */
  order?: WhatsAppCatalogOrder & { catalog_id?: string }
  interactive?: {
    type: 'button_reply' | 'list_reply' | 'nfm_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
    /** Completed native Meta Flow (form-screen) submission. */
    nfm_reply?: { name?: string; body?: string; response_json: string }
  }
  context?: { id: string }
  // Present only on the FIRST inbound message of a thread the buyer
  // started from a Click-to-WhatsApp ad (Instagram/Facebook). See
  // ctwa-attribution.ts.

  referral?: WhatsAppReferral
}
export interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
        errors?: Array<{
          code: number
          title: string
          message: string
          error_data?: {
            details?: string
          }
        }>
      }>
    }
    field: string
  }>
}

// ── Sandbox Routing ───────────────────────────────────────────────

const HASHTAG_REGEX = /^#([a-zA-Z0-9]+)\s*/

interface SandboxRouteResult {
  accountId: string
  userId: string
  sandboxCode: string
  isNewMapping: boolean
}

async function resolveSandboxAccount(
  message: WhatsAppMessage,
  senderPhone: string
): Promise<SandboxRouteResult | null> {
  const textBody = message.text?.body?.trim() || ''
  const hashtagMatch = textBody.match(HASHTAG_REGEX)

  // 1. Try hashtag prefix match
  if (hashtagMatch) {
    const code = hashtagMatch[1].toLowerCase()
    const { data: configRows } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, user_id, sandbox_code')
      .eq('integration_type', 'sandbox')
      .ilike('sandbox_code', code)
      .limit(1)

    if (configRows && configRows.length > 0) {
      const cfg = configRows[0]
      // Create or update mapping
      await supabaseAdmin()
        .from('sandbox_sender_mappings')
        .upsert(
          {
            sender_phone: senderPhone,
            account_id: cfg.account_id,
            sandbox_code: cfg.sandbox_code,
            updated_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
          } as unknown as never[],
          { onConflict: 'sender_phone' }
        )

      return {
        accountId: cfg.account_id,
        userId: cfg.user_id,
        sandboxCode: cfg.sandbox_code,
        isNewMapping: true,
      }
    }
  }

  // 2. Fallback: query existing sender mapping
  const { data: mapping } = await supabaseAdmin()
    .from('sandbox_sender_mappings')
    .select('*')
    .eq('sender_phone', senderPhone)
    .maybeSingle()

  if (mapping) {
    // Update last_message_at
    await supabaseAdmin()
      .from('sandbox_sender_mappings')
      .update({ last_message_at: new Date().toISOString() })
      .eq('sender_phone', senderPhone)

    return {
      accountId: (mapping as unknown as SandboxSenderMapping).account_id,
      userId: '', // Will be resolved below
      sandboxCode: (mapping as unknown as SandboxSenderMapping).sandbox_code,
      isNewMapping: false,
    }
  }

  return null
}

async function resolveSandboxOwnerUserId(accountId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (profile?.user_id as string) || ''
}

/**
 * The sandbox route for this sender, and the tenant config the caller
 * still needs for the message-limit check — or null when there is no
 * LIVE route.
 *
 * "Live" is the whole point: a mapping to a tenant whose trial has
 * lapsed used to resolve, and the message was then dropped with a bare
 * `continue`. Both callers already treat a null route as "not a sandbox
 * message", and that path answers — at the first call site by falling
 * through to whichever Official API account owns the number. So an
 * expired trial now releases its dead mapping and reports no route,
 * which puts the sender back on a path that replies instead of
 * blackholing them forever. See sandbox-trial.ts.
 */
async function resolveLiveSandboxRoute(
  message: WhatsAppMessage,
  senderPhone: string
): Promise<{
  route: SandboxRouteResult
  tenantConfig: SandboxTenantConfig | null
} | null> {
  const route = await resolveSandboxAccount(message, senderPhone)
  if (!route) return null

  const { data } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('trial_ends_at, sandbox_message_count, sandbox_message_limit')
    .eq('account_id', route.accountId)
    .maybeSingle()
  const tenantConfig = (data as SandboxTenantConfig | null) ?? null

  if (!isSandboxTrialExpired(tenantConfig)) return { route, tenantConfig }

  console.warn(
    `[webhook] Sandbox trial expired for account ${route.accountId} — releasing mapping for ${senderPhone} so this message can fall through instead of being dropped.`
  )
  await releaseSandboxSender(supabaseAdmin(), senderPhone)
  return null
}

export async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin(),
        )
        continue
      }

      // Group lifecycle/participants/settings/status. These carry no
      // `messages` or `contacts`, so they have to be dispatched before
      // the inbound-message path below drops them.
      if (isGroupWebhookField(change.field)) {
        const groupPhoneNumberId = (
          change.value as { metadata?: { phone_number_id?: string } }
        )?.metadata?.phone_number_id
        if (groupPhoneNumberId) {
          const { data: groupConfigs } = await supabaseAdmin()
            .from('whatsapp_config')
            .select('account_id')
            .eq('phone_number_id', groupPhoneNumberId)

          // Same rule as the message path: an ambiguous number is
          // dropped rather than written to an arbitrary account.
          if (groupConfigs?.length === 1) {
            await processGroupWebhook(
              groupConfigs[0].account_id as string,
              change.field,
              change.value as unknown,
            )
          } else {
            console.error(
              `[webhook] group event for phone_number_id ${groupPhoneNumberId} matched ${groupConfigs?.length ?? 0} configs. Dropping.`,
            )
          }
        }
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id
      console.log(`[webhook] Incoming messages for phone_number_id: ${phoneNumberId}, messages: ${value.messages.length}`)

      const sandboxSystem = await getSandboxSystemConfig()
      const isSystemSandboxNumber = sandboxSystem.enabled && sandboxSystem.phone_number_id === phoneNumberId

      // ── 1. If this is the shared sandbox number, try tenant routing per-message ──
      if (isSystemSandboxNumber) {
        console.log(`[webhook] phone_number_id ${phoneNumberId} matches system sandbox config. Trying hashtag/sender routing per message...`)

        for (let i = 0; i < value.messages.length; i++) {
          const message = value.messages[i]
          const contact = value.contacts[i] || value.contacts[0]
          const senderPhone = normalizePhone(message.from)

          console.log(`[webhook] Attempting sandbox routing for sender: ${senderPhone}, body: "${message.text?.body?.substring(0, 50) || '[non-text]'}"`)

          // Null here means "no live sandbox tenant owns this sender" —
          // never mapped, or mapped to a lapsed trial, which releases
          // itself. Either way the Official API fallback below answers.
          const live = await resolveLiveSandboxRoute(message, senderPhone)
          if (live) {
            const { route, tenantConfig } = live
            console.log(`[webhook] Resolved sandbox route: account=${route.accountId}, code=${route.sandboxCode}, newMapping=${route.isNewMapping}`)

            // Resolve owner user_id if not cached in mapping
            const ownerUserId = route.userId || await resolveSandboxOwnerUserId(route.accountId)

            // Rate limit check & atomic increment
            const msgLimit = tenantConfig?.sandbox_message_limit ?? 50
            const { data: allowed, error: rpcErr } = await supabaseAdmin()
              .rpc('increment_sandbox_message_count', {
                p_account_id: route.accountId,
                p_limit: msgLimit,
              });

            if (rpcErr || !allowed) {
              console.warn(`[webhook] Sandbox message limit reached or error for account ${route.accountId} (limit: ${msgLimit}). Dropping.`);
              continue;
            }

            // Strip the sandbox hashtag from the message text before storing
            // so the UI shows "hi" instead of "#convo870 hi"
            const cleanedMessage = { ...message }
            if (cleanedMessage.text?.body) {
              cleanedMessage.text = {
                ...cleanedMessage.text,
                body: cleanedMessage.text.body.replace(HASHTAG_REGEX, '').trim(),
              }
            }

            // Use system sandbox credentials if available
            let decryptedSystemToken = ''
            if (sandboxSystem.access_token) {
              try {
                decryptedSystemToken = decrypt(sandboxSystem.access_token)
              } catch (err) {
                console.warn('[webhook] Failed to decrypt sandbox system token:', err)
              }
            }

            await processMessage(
              cleanedMessage,
              contact,
              route.accountId,
              ownerUserId,
              decryptedSystemToken,
              phoneNumberId
            )
            continue
          }

          // No LIVE sandbox route for this message — fall back to Official API config (if same number is also an official number)
          console.warn(`[webhook] No live sandbox route for sender ${senderPhone}. Checking Official API fallback...`)

          const { data: fallbackConfigs } = await supabaseAdmin()
            .from('whatsapp_config')
            .select('*')
            .eq('phone_number_id', phoneNumberId)

          if (fallbackConfigs && fallbackConfigs.length === 1) {
            const fb = fallbackConfigs[0]
            console.log(`[webhook] Falling back to Official API account: ${fb.account_id}`)
            let fbToken: string
            try {
              fbToken = decrypt(fb.access_token)
            } catch (err) {
              console.error('[webhook] Failed to decrypt fallback access_token:', err)
              continue
            }
            await processMessage(message, contact, fb.account_id, fb.user_id, fbToken, fb.phone_number_id)
            continue
          }

          console.warn(`[webhook] No sandbox route and no Official API fallback for sender ${senderPhone}. Dropping. Body: "${message.text?.body || ''}"`)
        }
        continue
      }

      // ── 2. Normal Official API flow (phone_number_id is NOT the sandbox number) ──
      const { data: officialConfigs, error: officialError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (officialError) {
        console.error('[webhook] Error fetching Official API configs:', officialError)
      }

      if (officialConfigs && officialConfigs.length > 0) {
        if (officialConfigs.length > 1) {
          console.error(
            `[webhook] Multiple configs (${officialConfigs.length}) for phone_number_id ${phoneNumberId}. Dropping.`
          )
          continue
        }

        const config = officialConfigs[0]
        console.log(`[webhook] Matched Official API account: ${config.account_id}`)

        // Trial expiration check (for official_api, trial_ends_at is usually null)
        if (config.integration_type !== 'official_api' && config.trial_ends_at) {
          if (new Date() > new Date(config.trial_ends_at)) {
            console.warn(`[webhook] Trial expired for account ${config.account_id}. Dropping message.`)
            continue
          }
        }

        let decryptedAccessToken: string
        try {
          decryptedAccessToken = decrypt(config.access_token)
        } catch (err) {
          console.error('[webhook] Failed to decrypt access_token:', err)
          continue
        }

        for (let i = 0; i < value.messages.length; i++) {
          const message = value.messages[i]
          const contact = value.contacts[i] || value.contacts[0]
          await processMessage(
            message,
            contact,
            config.account_id,
            config.user_id,
            decryptedAccessToken,
            config.phone_number_id
          )
        }
        continue
      }

      // ── 2. No Official API match — try Sandbox routing ─────────
      console.log(`[webhook] No Official API config for ${phoneNumberId}. Trying sandbox hashtag/sender routing...`)

      const fallbackSandboxSystem = await getSandboxSystemConfig()

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]
        const senderPhone = normalizePhone(message.from)

        console.log(`[webhook] Attempting sandbox routing for sender: ${senderPhone}, body: "${message.text?.body?.substring(0, 50) || '[non-text]'}"`)

        // This number has no Official API config at all, so there is
        // nothing to fall through to — the message is genuinely
        // unroutable. An expired trial still releases its mapping on
        // the way past, so the sender is no longer pinned to a dead
        // tenant the day an official config does exist.
        const live = await resolveLiveSandboxRoute(message, senderPhone)
        if (!live) {
          console.warn(`[webhook] No live sandbox route for sender ${senderPhone}, and no Official API config for ${phoneNumberId}. Dropping. Body: "${message.text?.body || ''}"`)
          continue
        }

        const { route, tenantConfig } = live
        console.log(`[webhook] Resolved sandbox route: account=${route.accountId}, code=${route.sandboxCode}, newMapping=${route.isNewMapping}`)

        // Resolve owner user_id if not cached in mapping
        const ownerUserId = route.userId || await resolveSandboxOwnerUserId(route.accountId)

        // Rate limit check & atomic increment
        const msgLimit = tenantConfig?.sandbox_message_limit ?? 50
        const { data: allowed, error: rpcErr } = await supabaseAdmin()
          .rpc('increment_sandbox_message_count', {
            p_account_id: route.accountId,
            p_limit: msgLimit,
          });

        if (rpcErr || !allowed) {
          console.warn(`[webhook] Sandbox message limit reached or error for account ${route.accountId} (limit: ${msgLimit}). Dropping.`);
          continue;
        }

        // Use system sandbox credentials if available; otherwise empty (text-only processing)
        let decryptedSystemToken = ''
        if (fallbackSandboxSystem.enabled && fallbackSandboxSystem.access_token) {
          try {
            decryptedSystemToken = decrypt(fallbackSandboxSystem.access_token)
          } catch (err) {
            console.warn('[webhook] Failed to decrypt sandbox system token:', err)
          }
        } else {
          console.warn('[webhook] Sandbox system credentials not configured. Media downloads may fail, but text processing will continue.')
        }

        await processMessage(
          message,
          contact,
          route.accountId,
          ownerUserId,
          decryptedSystemToken,
          phoneNumberId
        )
      }
      continue

    }
  }
}

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: Array<{
    code: number
    title: string
    message: string
    error_data?: {
      details?: string
    }
  }>
}) {
  console.log(`[webhook] Received status update: ${status.id} -> ${status.status}`)
  if (status.status === 'failed' || status.errors) {
    console.error(`[webhook] Status FAILED for message ${status.id} to recipient ${status.recipient_id}. Errors:`, JSON.stringify(status.errors, null, 2))
  }

  const updatePayload: Record<string, unknown> = { status: status.status }

  if (status.status === 'failed' && status.errors && status.errors.length > 0) {
    const errorDetails = status.errors
      .map((e) => `[Error ${e.code}] ${e.message}${e.error_data?.details ? `: ${e.error_data.details}` : ''}`)
      .join('\n')
    
    try {
      const { data: existingMsg } = await supabaseAdmin()
        .from('messages')
        .select('content_text')
        .eq('message_id', status.id)
        .maybeSingle()

      if (existingMsg) {
        const originalText = existingMsg.content_text || ''
        if (!originalText.includes(DELIVERY_FAILURE_MARKER)) {
          updatePayload.content_text =
            `${originalText}\n\n${DELIVERY_FAILURE_MARKER}\n${errorDetails}`.trim()
        }
      }
    } catch (err) {
      console.error('Failed to append error message to content_text:', err)
    }
  }

  const { data: updatedMsg, error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update(updatePayload)
    .eq('message_id', status.id)
    .select('id')

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  } else if (!updatedMsg || updatedMsg.length === 0) {
    console.warn(`[webhook] Message with message_id ${status.id} not found in DB messages table.`)
  } else {
    console.log(`[webhook] Updated message status in DB for message_id ${status.id} to ${status.status}`)
  }

  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
    return
  }
  if (!recipient) return

  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  const { error: recUpdateErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .update(update)
    .eq('id', recipient.id)

  if (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr)
  }
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

const REMINDER_RESCHEDULE_BUTTON_TEXT = 'Requesting reschedule'
const REMINDER_CONFIRM_BUTTON_TEXT = 'Fine'

/**
 * A tap on either of the reminder's quick-reply buttons
 * (supabase/migrations/141_reminder_reschedule_buttons.sql) arrives as
 * message.type === 'button' with context.id pointing at the original
 * outbound reminder — matched via the wa_message_id reminder.ts
 * stamps onto appointment_reminder_log after each send.
 *
 * "Requesting reschedule" flags the appointment and pings the agent.
 * "Fine" stamps client_confirmed_at (migration 151), acks the client
 * in-thread, and pings the agent. Returns true when the tap belonged
 * to a reminder so the caller stops processing — before this, "Fine"
 * fell through as an ordinary message: silence for a client, and for
 * owner-phone senders the AI ingestion chatbot answered a meeting
 * confirmation with its welcome text.
 */
async function handleReminderButtonReply(
  message: WhatsAppMessage,
  accountId: string,
  contactId: string,
  conversationId: string,
  ownerUserId: string
): Promise<boolean> {
  const buttonText = message.button?.text
  const isReschedule = buttonText === REMINDER_RESCHEDULE_BUTTON_TEXT
  const isConfirm = buttonText === REMINDER_CONFIRM_BUTTON_TEXT
  if ((!isReschedule && !isConfirm) || !message.context?.id) return false

  try {
    const admin = supabaseAdmin()
    const { data: log } = await admin
      .from('appointment_reminder_log')
      .select('appointment_id')
      .eq('wa_message_id', message.context.id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!log?.appointment_id) return false

    // Each tap resolves the other flag — the latest client signal wins.
    const stamp = isReschedule
      ? { reschedule_requested_at: new Date().toISOString(), client_confirmed_at: null }
      : { client_confirmed_at: new Date().toISOString(), reschedule_requested_at: null }

    const { data: appt } = await admin
      .from('appointments')
      .update(stamp)
      .eq('id', log.appointment_id)
      .select('id, title, start_time, user_id, assigned_to')
      .maybeSingle()
    // Reminder tap on a since-deleted appointment: still consumed.
    if (!appt) return true

    const formattedTime = new Date(appt.start_time).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    if (isConfirm) {
      // Ack in-thread — the client just messaged, so the 24h session
      // window is open for free-form text.
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: ownerUserId,
        contactId,
        conversationId,
        kind: 'text',
        senderType: 'bot',
        text: `✅ Thank you! Your meeting "${appt.title}" on ${formattedTime} is confirmed. See you there!`,
      })
    }

    const agentUserId = appt.assigned_to || appt.user_id
    if (!agentUserId) return true

    const { data: agentProfile } = await admin
      .from('profiles')
      .select('phone')
      .eq('user_id', agentUserId)
      .maybeSingle()
    if (!agentProfile?.phone) return true
    const agentPhone = sanitizePhoneForMeta(agentProfile.phone)
    if (!isValidE164(agentPhone)) return true

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: agentUserId,
      toPhone: agentPhone,
      kind: 'text',
      senderType: 'bot',
      text: isReschedule
        ? `🔄 Reschedule requested for "${appt.title}" on ${formattedTime}. The client tapped "Requesting reschedule" on their reminder — reach out to find a new time.`
        : `✅ Meeting confirmed: "${appt.title}" on ${formattedTime}. The client tapped "Fine" on their reminder.`,
    })
    return true
  } catch (err) {
    console.error('[webhook] handleReminderButtonReply failed:', err)
    // The text matched a reminder button — swallow rather than letting
    // a partial failure leak the tap into the chatbot flows.
    return true
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  accountId: string,
  configOwnerUserId: string,
  accessToken: string,
  phoneNumberId: string
) {
  // Archived accounts (dormant/expired, see 113_account_archival.sql) must
  // not keep ingesting messages or burning AI credits. getCurrentAccount()
  // blocks the authed API surface, but the webhook is unauthenticated and
  // resolves accountId directly from whatsapp_config — this is the
  // equivalent chokepoint for the inbound-message path. Mirrors the
  // existing "sandbox trial expired ... dropping" guard below.
  const { data: accountRow } = await supabaseAdmin()
    .from('accounts')
    .select('status')
    .eq('id', accountId)
    .maybeSingle()
  if ((accountRow as { status?: string } | null)?.status === 'archived') {
    console.warn(`[webhook] Account ${accountId} is archived. Dropping message.`)
    return
  }

  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // A group message reaches us on this same `messages` field, and `from`
  // is the PARTICIPANT. Everything below would therefore file it in that
  // person's private thread and let the bot answer them directly — so
  // groups are split off before any contact or conversation is touched.
  const waGroupId = groupIdFromInbound(message)
  if (waGroupId) {
    const thread = await resolveGroupThread(accountId, waGroupId)
    if (!thread) {
      console.warn(
        `[webhook] group message for unknown group ${waGroupId} on account ${accountId}. Dropping.`
      )
      return
    }
    const parsed = await parseMessageContent(message, accessToken)
    const senderContactId = await resolveGroupSender(accountId, senderPhone)

    await supabaseAdmin().from('messages').insert({
      conversation_id: thread.conversationId,
      sender_type: 'customer',
      content_type:
        message.type === 'sticker'
          ? 'image'
          : message.type === 'order'
            ? 'text'
            : message.type,
      content_text: parsed.contentText,
      media_url: parsed.mediaUrl,
      message_id: message.id,
      status: 'delivered',
      // In a group the conversation no longer says who wrote this.
      sender_wa_id: senderPhone,
      sender_contact_id: senderContactId,
    })

    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: parsed.contentText || `[${message.type}]`,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', thread.conversationId)

    // No bot, no automations, no flows. Every automated reply path the
    // Engine has answers with buttons or lists, which groups reject
    // outright (130501) — the members would see nothing, and a
    // plain-text fallback would go to all eight of them.
    return
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const conversation = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id
  )
  if (!conversation) return

  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId, nfmResponseJson } =
    await parseMessageContent(message, accessToken)

  // Org hierarchy routing (migration 082/083) — only for conversations
  // that aren't already assigned, and only for accounts past Solo Mode
  // (2+ members). Solo accounts skip this entirely: no query, no
  // behavior change, conversation stays unassigned and every message
  // continues to land in the sole user's inbox exactly as before.
  let routingUpdate: {
    assigned_agent_id?: string | null
    assigned_team_id?: string | null
    routing_rule_used?: string | null
    assigned_at?: string | null
  } = {}
  if (!conversation.assigned_agent_id && !conversation.assigned_team_id) {
    const { count: memberCount } = await supabaseAdmin()
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((memberCount ?? 0) >= 2) {
      const routingResult = await resolveRouting({
        accountId,
        phone: senderPhone,
        messageText: contentText || '',
        contactId: contactRecord.id,
        contactAssignedAgentId: (contactRecord as { assigned_agent_id?: string | null }).assigned_agent_id,
        source: (contactRecord as { source?: string | null }).source,
      })
      routingUpdate = {
        assigned_agent_id: r…19612 tokens truncated…Type: 'bot',
    })
    if (!detailsResult.success) {
      console.error('[webhook] Property details send failed:', propertyId, detailsResult.error)
      return false
    }

    await logPropertyShare(
      supabaseAdmin(),
      accountId,
      configOwnerUserId,
      propertyId,
      contactId,
    )

    const followUp = options.followUp ?? 'feedback'
    if (followUp === 'questions') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: buildPropertyInterestQuestion(),
        senderType: 'bot',
      })
      console.log(`[webhook] Successfully shared property ${propertyId} with contact ${contactId}`)
      return true
    }

    if (followUp === 'none') return true

    // This is the first confirmed reply after an out-of-window template.
    // Ask for explicit listing feedback now that WhatsApp permits a
    // free-form interactive message. Explore actions stay in the same
    // list so the previous browse path remains available.
    const feedbackSent = await sendListingFeedbackPrompt({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      matches: [{ property: typedProperty }],
      includeFormRow: true,
      includeExploreRows: true,
      sourcePropertyId: typedProperty.id,
    })

    // Preserve the old browse controls if the richer feedback prompt
    // cannot be delivered for any reason.
    if (!feedbackSent) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveBody: 'Would you like to explore other properties?',
        interactiveButtons: [
          { id: `show_more_properties:${typedProperty.id}`, title: 'Show More Properties' },
          { id: 'browse_all_properties', title: 'Browse All' },
          { id: `share_property_no:${typedProperty.id}`, title: 'No Thanks' }
        ],
        senderType: 'bot',
      })
    }

    console.log(`[webhook] Successfully shared property ${propertyId} with contact ${contactId}`)
    return true
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareYesReply:', err)
    return false
  }
}

/**
 * Acts on an enquiry-card tap.
 *
 * Every branch resolves the BUYER's conversation first: the tap came
 * from the agent's thread, and sending the photos into that thread
 * would deliver them to the agent who already has them. Returns true
 * when the tap was consumed, so the agent's own message never falls
 * through to the owner chatbot underneath it.
 */
async function handleEnquiryCardReply(
  action: ReturnType<typeof parseEnquiryReply> & object,
  accountId: string,
  configOwnerUserId: string,
  /** The AGENT's own thread — where the tap arrived, and where the
   *  outcome is confirmed, the same way the location card answers
   *  "Approved — ConvoReal has sent the exact location...". */
  agentThread: { contactId: string; conversationId: string },
): Promise<boolean> {
  const admin = supabaseAdmin()

  const { data: lead } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('id', action.contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!lead?.phone) return false

  const confirmToAgent = async (text: string) => {
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: agentThread.contactId,
      conversationId: agentThread.conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
    })
  }

  const { data: propertyRow } = await admin
    .from('properties')
    .select('title')
    .eq('id', action.propertyId)
    .eq('account_id', accountId)
    .maybeSingle()
  const propertyLabel = propertyRow?.title
    ? `*${propertyRow.title}*`
    : 'the listing'

  // Reject and "I'll reply" are the agent taking the thread: the
  // conversation is flagged pending so it sits at the top of the inbox
  // for them to answer personally. Reject also closes the bot's side
  // with the buyer — the ack promised them the details "shortly", so
  // instead of going silent it points them at the team's own number.
  // The legacy "I'll answer" button stays fully quiet, as it said.
  if (action.action === 'reject' || action.action === 'mine') {
    await admin
      .from('conversations')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('contact_id', action.contactId)
      .eq('account_id', accountId)
    if (action.action === 'reject') {
      const teamPhone = await resolveEnquiryTeamPhone(
        admin,
        accountId,
        configOwnerUserId,
      )
      const { conversation: leadConversation } = await resolveConversation<{
        id: string
      }>(admin, {
        accountId,
        contactId: action.contactId,
        userId: configOwnerUserId,
        columns: 'id',
      })
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: action.contactId,
        ...(leadConversation ? { conversationId: leadConversation.id } : {}),
        toPhone: lead.phone as string,
        kind: 'text',
        senderType: 'bot',
        text: buildEnquiryRejectText(lead.name, propertyRow?.title, teamPhone),
      })
      await confirmToAgent(
        `❌ Rejected — ${lead.name || lead.phone} was asked to reach your team directly${teamPhone ? ` on ${teamPhone}` : ''}. The thread is flagged for you in the inbox.`,
      )
    } else {
      await confirmToAgent(
        `❌ Rejected — nothing was sent to ${lead.name || lead.phone}. The thread is flagged for you in the inbox.`,
      )
    }
    return true
  }

  const { conversation } = await resolveConversation<{ id: string }>(admin, {
    accountId,
    contactId: action.contactId,
    userId: configOwnerUserId,
    columns: 'id',
  })
  if (!conversation) return false

  if (action.action === 'photos') {
    const sent = await sendSubjectPhotos({
      db: admin,
      accountId,
      userId: configOwnerUserId,
      contactId: action.contactId,
      conversationId: conversation.id,
      propertyIds: [action.propertyId],
      requestText: 'photos',
    })
    if (sent) {
      await confirmToAgent(
        `✅ Photos of ${propertyLabel} sent to ${lead.name || lead.phone} on WhatsApp.`,
      )
      return true
    }
    // No public photos to send — fall through to the details, which is
    // the closest thing to what the buyer asked for.
  }

  // Approve (and the legacy "details" button): the complete details —
  // photo, price, specs, description and the listing link — straight to
  // the buyer's number.
  await handlePropertyShareYesReply(
    action.propertyId,
    accountId,
    configOwnerUserId,
    action.contactId,
    conversation.id,
    lead.phone as string,
  )
  await confirmToAgent(
    `✅ Approved — complete details for ${propertyLabel} sent to ${lead.name || lead.phone} on WhatsApp.`,
  )
  return true
}

export async function handlePropertyShareNoReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const politeMessage = `No problem! If you would like to explore our other listings anytime, tap the button below.`
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: politeMessage,
      interactiveButtons: [
        { id: 'browse_all_properties', title: 'Browse Properties' }
      ],
      senderType: 'bot',
    })
    console.log(`[webhook] Handled share no reply for contact ${contactId}`)
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareNoReply:', err)
  }
}

export async function handleBrowseAllProperties(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const { data: properties, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(10)

    const typedProperties = properties as PropertyRow[] | null

    if (error || !typedProperties || typedProperties.length === 0) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: `We don't have any other active listings at the moment. Please check back later!`,
        senderType: 'bot',
      })
      return
    }

    const rows = typedProperties.map((prop) => {
      let priceStr = ''
      const amount = Number(prop.price)
      if (!isNaN(amount) && amount > 0) {
        if (amount >= 10000000) {
          priceStr = `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
        } else if (amount >= 100000) {
          priceStr = `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} L`
        } else {
          priceStr = `₹${amount}`
        }
      }

      const areaStr = prop.area_sqft ? `${prop.area_sqft} ${prop.area_unit || 'Sq.Ft.'}` : ''
      const details = [priceStr, areaStr, prop.bedrooms ? `${prop.bedrooms} BHK` : ''].filter(Boolean).join(' | ')

      return {
        id: `share_property_yes:${prop.id}`,
        title: prop.title.substring(0, 24),
        description: details.substring(0, 72),
      }
    })

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'list',
      interactiveBody: `Explore our top available properties below. Tap a property to see full details and photos.`,
      interactiveButtonLabel: `View Properties`,
      interactiveSections: [
        {
          title: `Active Listings`,
          rows,
        },
      ],
      senderType: 'bot',
    })

    console.log(`[webhook] Sent interactive browse list to contact ${contactId}`)
  } catch (err) {
    console.error('[webhook] Failed to handle browse all properties:', err)
  }
}

// ============================================================
// Update Intent Handlers
// ============================================================

interface UpdateField {
  name: string
  label: string
  type: 'text' | 'number' | 'select'
  options?: string[]
  current_value?: string
}

const PROPERTY_UPDATABLE_FIELDS: UpdateField[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'price', label: 'Price (INR)', type: 'number' },
  { name: 'status', label: 'Status', type: 'select', options: ['Available', 'Sold', 'Rented', 'Under Contract', 'Withdrawn'] },
  { name: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { name: 'bathrooms', label: 'Bathrooms', type: 'number' },
  { name: 'area_sqft', label: 'Area (Sq.Ft.)', type: 'number' },
  { name: 'location', label: 'Location', type: 'text' },
  { name: 'description', label: 'Description', type: 'text' },
]

const CONTACT_UPDATABLE_FIELDS: UpdateField[] = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'classification', label: 'Classification', type: 'select', options: ['Buyer', 'Seller', 'Agent', 'Owner', 'Owner & Buyer', 'Developer', 'Others'] },
  { name: 'budget_min', label: 'Budget Min (INR)', type: 'number' },
  { name: 'budget_max', label: 'Budget Max (INR)', type: 'number' },
  { name: 'preferred_location', label: 'Preferred Location', type: 'text' },
]

// Parse update intent from message text
/**
 * Answer a buyer's preference-update request: the listings-first tap
 * reply, then the Buyer Preference Intake flow as an optional shortcut.
 * Returns true when either message was sent (message consumed); false
 * when the account has no published flow or both sends failed, letting
 * the message fall through to normal handling.
 */
async function handlePreferenceFlowTrigger(
  accountId: string,
  contactId: string,
  configOwnerUserId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const flow = await getPublishedPreferenceFlow(accountId)
    if (!flow) return false

    const tap = await sendPreferenceTapReply({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
    })

    // When a follow-on list (feedback or budget bands) already carries
    // an "Update preferences" row, a third bubble repeating the form
    // would bury it. Otherwise the form is the main action.
    if (tap.replySent && tap.formOffered) {
      console.log(
        `[webhook] Sent preference tap reply (${tap.matchCount} matches) + tap list to contact ${contactId}`
      )
      return true
    }

    const result = await sendPreferenceFlowToContact({
      accountId,
      contactId,
      senderType: 'bot',
      // The listings reply already made the ask; the form must not
      // repeat it as homework.
      bodyText: tap.replySent
        ? 'Prefer to update everything at once instead? The full form takes under a minute.'
        : undefined,
    })
    if (!result.success) {
      console.error(`[webhook] Preference flow send failed: ${result.error}`)
      return tap.replySent
    }
    console.log(
      `[webhook] Sent preference tap reply (${tap.matchCount} matches) + flow to contact ${contactId}`
    )
    return true
  } catch (err) {
    console.error('[webhook] Preference flow trigger error:', err)
    return false
  }
}

/**
 * Handle the nfm_reply webhook for a completed preference form.
 * Persists the values (no-op if the encrypted endpoint already did at
 * submit time) and sends the in-chat confirmation summary.
 */
async function handlePreferenceFlowNfmReply(
  responseJson: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string
) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(responseJson)
  } catch {
    console.error('[webhook] nfm_reply response_json is not valid JSON')
    return
  }

  const flowToken = typeof parsed.flow_token === 'string' ? parsed.flow_token : null
  if (!flowToken) {
    console.warn('[webhook] nfm_reply without flow_token — ignoring')
    return
  }

  const result = await applyPreferenceFlowResponse({
    flowToken,
    values: parsed,
    expectedAccountId: accountId,
  })

  if (!result.applied && !result.alreadyCompleted) {
    console.error(`[webhook] Preference flow reply rejected: ${result.error}`)
    return
  }
  if (result.session && result.session.contact_id !== contactId) {
    console.error('[webhook] Preference flow token belongs to a different contact — ignoring')
    return
  }

  // The endpoint's data_exchange response usually saved the values
  // already (alreadyCompleted); recompute the summary from the reply
  // payload so the confirmation always reflects what was submitted.
  const update =
    result.update ?? preferenceFormToContactUpdate(parsePreferenceFormValues(parsed))

  await sendPreferenceMatchFollowUp({
    db: supabaseAdmin(),
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
    acknowledgement: summarizePreferenceUpdate(update),
    reviewNoMatch: false,
  })
}

function parseUpdateIntent(text: string): {
  type: 'property' | 'contact' | null
  identifier?: string
} | null {
  const cleaned = text.trim().toLowerCase()
  
  // Match patterns like "update property PROP-1018", "update contact", "update PROP-1018"
  const propertyWithCode = /\bupdate\s+(?:property\s+)?(prop-?\d+)\b/i.exec(cleaned)
  if (propertyWithCode) {
    return { type: 'property', identifier: propertyWithCode[1].toUpperCase() }
  }
  
  const propertyGeneric = /\bupdate\s+property\b/i.test(cleaned)
  if (propertyGeneric) {
    return { type: 'property' }
  }
  
  const contactUpdate = /\bupdate\s+contact\b/i.test(cleaned)
  if (contactUpdate) {
    return { type: 'contact' }
  }
  
  // Generic "update" might default to contact update for the current conversation
  const genericUpdate = /^update$/i.test(cleaned)
  if (genericUpdate) {
    return { type: 'contact' }
  }
  
  return null
}

// Org roles (org_manager > org_leader > org_coordinator > org_agent) are the
// source of truth; account_role (owner/admin/coordinator/agent/viewer) is the
// legacy mirror kept in lockstep by a trigger: owner↔org_manager,
// admin↔org_leader, coordinator↔org_coordinator, agent↔org_agent, viewer→org_agent.
// Managers, leaders, coordinators, and agents may update.
// Agents (and coordinators) are matched via account_role rather than org_role
// ON PURPOSE: viewers collapse to org_agent too (with is_read_only), so
// org_agent cannot distinguish an agent from a read-only viewer. Do NOT add
// 'org_agent' to the org-role set — it would let viewers mutate records.
// (Coordinator is safe on the account_role side: it's a distinct value and is
// never read-only.)
const UPDATE_STAFF_ACCOUNT_ROLES = ['owner', 'admin', 'coordinator', 'agent']
const UPDATE_STAFF_ORG_ROLES = ['org_manager', 'org_leader']

/**
 * Account staff who may update ANY property or contact over WhatsApp:
 * managers, leaders, and agents (via the role sets above). Matched by the
 * sender's phone against a staff profile on the same account. Non-staff
 * senders can still update a specific record they own — see
 * isAuthorizedForUpdateSession / the owner checks in the intent handlers.
 */
async function isUpdateStaffSender(
  senderPhone: string,
  accountId: string
): Promise<boolean> {
  try {
    const { data: staffProfiles, error } = await supabaseAdmin()
      .from('profiles')
      .select('phone, account_role, org_role')
      .eq('account_id', accountId)
      .or(
        `account_role.in.(${UPDATE_STAFF_ACCOUNT_ROLES.join(',')}),org_role.in.(${UPDATE_STAFF_ORG_ROLES.join(',')})`
      )

    if (error || !staffProfiles || staffProfiles.length === 0) {
      if (error) {
        console.error('[webhook] Error querying staff profiles for update authorization:', error)
      }
      return false
    }

    return staffProfiles.some(
      (p: { phone: string | null }) => p.phone && phonesMatch(p.phone, senderPhone)
    )
  } catch (err) {
    console.error('[webhook] Exception in isUpdateStaffSender:', err)
    return false
  }
}

/**
 * Authorize an inbound sender to continue an in-progress update session.
 * A session is owned by the sender when it targets their own contact
 * record, or a property they listed (properties.owner_contact_id). Staff
 * may act on any session. Guards pre-existing sessions and any session
 * whose ownership must be re-verified on each incoming message.
 */
async function isAuthorizedForUpdateSession(
  session: { update_type: string; target_id: string },
  contactRecord: { id: string },
  senderPhone: string,
  accountId: string
): Promise<boolean> {
  if (session.update_type === 'contact') {
    if (session.target_id === contactRecord.id) return true
  } else if (session.update_type === 'property') {
    const { data: prop } = await supabaseAdmin()
      .from('properties')
      .select('owner_contact_id')
      .eq('id', session.target_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (prop && prop.owner_contact_id && prop.owner_contact_id === contactRecord.id) {
      return true
    }
  }
  return isUpdateStaffSender(senderPhone, accountId)
}

// Handle incoming update intent
export async function handleUpdateIntent(
  intent: { type: 'property' | 'contact'; identifier?: string },
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  try {
    // Check for existing active update session
    const { data: existingSession } = await supabaseAdmin()
      .from('update_sessions')
      .select('*')
      .eq('contact_id', contactRecord.id)
      .eq('status', 'collecting')
      .maybeSingle()

    if (existingSession) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `You have an ongoing update session. Please complete or cancel it first by sending "cancel".`,
        senderType: 'bot',
      })
      return true
    }

    if (intent.type === 'property') {
      return await handlePropertyUpdateIntent(intent.identifier, accountId, configOwnerUserId, contactRecord, conversation, senderPhone)
    }
    return await handleContactUpdateIntent(accountId, configOwnerUserId, contactRecord, conversation, senderPhone)
  } catch (err) {
    console.error('[webhook] Failed to handle update intent:', err)
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: 'Sorry, something went wrong. Please try again.',
      senderType: 'bot',
    })
    return true
  }
}

// Handle property update intent
async function handlePropertyUpdateIntent(
  identifier: string | undefined,
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  let property = null

  if (identifier) {
    // Find property by code
    const { data } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .ilike('property_code', identifier)
      .maybeSingle()
    property = data
  } else {
    // Find the last property this contact inquired about
    const contactWithProp = contactRecord as { id: string; name?: string; phone: string; last_inquired_property_id?: string }
    if (contactWithProp.last_inquired_property_id) {
      const { data } = await supabaseAdmin()
        .from('properties')
        .select('*')
        .eq('account_id', accountId)
        .eq('id', contactWithProp.last_inquired_property_id)
        .maybeSingle()
      property = data
    }
  }

  if (!property) {
    // Only reveal that a property does or doesn't exist to account staff;
    // for everyone else fall through silently so the feature stays hidden.
    if (!(await isUpdateStaffSender(senderPhone, accountId))) return false
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: identifier
        ? `I couldn't find a property with code "${identifier}". Please check the property code and try again.`
        : `I couldn't find a property associated with your account. Please specify the property code (e.g., "Update Property PROP-1018").`,
      senderType: 'bot',
    })
    return true
  }

  // Authorize: account staff may update any property; a non-staff sender
  // may only update a property they listed over WhatsApp
  // (properties.owner_contact_id). Unauthorized senders fall through.
  const isOwner = property.owner_contact_id != null && property.owner_contact_id === contactRecord.id
  if (!isOwner && !(await isUpdateStaffSender(senderPhone, accountId))) {
    return false
  }

  // Create update session
  const pendingFields = PROPERTY_UPDATABLE_FIELDS.map(f => f.name)
  
  await supabaseAdmin().from('update_sessions').insert({
    account_id: accountId,
    contact_id: contactRecord.id,
    update_type: 'property',
    target_id: property.id,
    target_identifier: property.property_code || property.id,
    collected_fields: {},
    pending_fields: pendingFields,
    status: 'collecting',
  })

  // Ask for first field
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Let's update *${property.title || property.property_code}*\n\nCurrent values:\n${PROPERTY_UPDATABLE_FIELDS.map(f => `• ${f.label}: ${property[f.name] || 'not set'}`).join('\n')}\n\nWhat would you like to update?\n\nSend the field name (e.g., "price", "status", "title") or send "all" to update fields one by one.`,
    senderType: 'bot',
  })
  return true
}

// Handle contact update intent
async function handleContactUpdateIntent(
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
): Promise<boolean> {
  // The contact update always targets the sender's own contact record, so
  // the sender is by definition the owner of what they're editing.
  // Create update session for contact
  const pendingFields = CONTACT_UPDATABLE_FIELDS.map(f => f.name)
  
  await supabaseAdmin().from('update_sessions').insert({
    account_id: accountId,
    contact_id: contactRecord.id,
    update_type: 'contact',
    target_id: contactRecord.id,
    target_identifier: contactRecord.phone,
    collected_fields: {},
    pending_fields: pendingFields,
    status: 'collecting',
  })

  // Ask for first field
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Let's update your contact details\n\nCurrent values:\n${CONTACT_UPDATABLE_FIELDS.map(f => `• ${f.label}: ${(contactRecord as Record<string, unknown>)[f.name] || 'not set'}`).join('\n')}\n\nWhat would you like to update?\n\nSend the field name (e.g., "name", "email", "classification") or send "all" to update fields one by one.`,
    senderType: 'bot',
  })
  return true
}

// Handle update session input
export async function handleUpdateSessionInput(
  sessionId: string,
  text: string,
  accountId: string,
  configOwnerUserId: string,
  contactRecord: { id: string; name?: string; phone: string },
  conversation: { id: string },
  senderPhone: string
) {
  const { data: session } = await supabaseAdmin()
    .from('update_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return false

  const cleanedText = text.trim().toLowerCase()

  // Handle cancel
  if (cleanedText === 'cancel') {
    await supabaseAdmin()
      .from('update_sessions')
      .update({ status: 'cancelled' })
      .eq('id', sessionId)

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: 'Update cancelled.',
      senderType: 'bot',
    })
    return true
  }

  // Handle "all" to start field-by-field update
  if (cleanedText === 'all') {
    const fields = session.update_type === 'property' ? PROPERTY_UPDATABLE_FIELDS : CONTACT_UPDATABLE_FIELDS
    const firstField = fields[0]
    
    await supabaseAdmin()
      .from('update_sessions')
      .update({ 
        pending_fields: fields.map(f => f.name),
        status: 'collecting' 
      })
      .eq('id', sessionId)

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      toPhone: senderPhone,
      kind: 'text',
      text: `Let's update fields one by one.\n\nEnter new value for *${firstField.label}*:\n(current: ${firstField.current_value || 'not set'})\n\nSend "skip" to skip this field.`,
      senderType: 'bot',
    })
    return true
  }

  // Handle field-specific update (e.g., "price 1.5cr", "status sold")
  const fieldMatch = /^(\w+)\s+(.+)$/m.exec(text.trim())
  if (fieldMatch) {
    const [, fieldName, value] = fieldMatch
    const fields = session.update_type === 'property' ? PROPERTY_UPDATABLE_FIELDS : CONTACT_UPDATABLE_FIELDS
    const field = fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase())
    
    if (!field) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `Invalid field "${fieldName}". Available fields: ${fields.map(f => f.name).join(', ')}`,
        senderType: 'bot',
      })
      return true
    }

    // Validate select fields
    if (field.type === 'select' && field.options) {
      const validOption = field.options.find(o => o.toLowerCase() === value.toLowerCase())
      if (!validOption) {
        await sendWhatsAppMessageAndPersist({
          accountId,
          userId: configOwnerUserId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          toPhone: senderPhone,
          kind: 'text',
          text: `Invalid value "${value}". Choose from: ${field.options.join(', ')}`,
          senderType: 'bot',
        })
        return true
      }
    }

    // Update the field
    const updateData: Record<string, unknown> = {}
    if (session.update_type === 'property') {
      updateData[field.name] = field.type === 'number' ? Number(value) || value : value
      await supabaseAdmin()
        .from('properties')
        .update(updateData)
        .eq('id', session.target_id)
    } else {
      updateData[field.name] = field.type === 'number' ? Number(value) || value : value
      await supabaseAdmin()
        .from('contacts')
        .update(updateData)
        .eq('id', session.target_id)
    }

    // Remove field from pending
    const remainingFields = (session.pending_fields as string[]).filter(f => f !== field.name)
    
    if (remainingFields.length === 0) {
      // All fields updated
      await supabaseAdmin()
        .from('update_sessions')
        .update({ status: 'completed', pending_fields: [], collected_fields: { ...session.collected_fields, [field.name]: value } })
        .eq('id', sessionId)

      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `✅ Updated *${field.label}* to "${value}"\n\nAll done! Your ${session.update_type} has been updated.`,
        senderType: 'bot',
      })
    } else {
      // More fields to update
      await supabaseAdmin()
        .from('update_sessions')
        .update({ 
          pending_fields: remainingFields,
          collected_fields: { ...session.collected_fields, [field.name]: value }
        })
        .eq('id', sessionId)

      const nextField = fields.find(f => f.name === remainingFields[0])
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        text: `✅ Updated *${field.label}* to "${value}"\n\nEnter new value for *${nextField?.label || remainingFields[0]}*:\nSend "skip" to skip, or "done" to finish.`,
        senderType: 'bot',
      })
    }
    return true
  }

  // If we're in collecting mode and no field specified, show available fields
  const fields = session.update_type === 'property' ? PROPERTY_UPDATABLE_FIELDS : CONTACT_UPDATABLE_FIELDS
  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    toPhone: senderPhone,
    kind: 'text',
    text: `Please specify the field and value.\n\nExamples:\n• "price 1.5cr"\n• "status sold"\n• "title New Title"\n\nAvailable fields: ${fields.map(f => f.name).join(', ')}\n\nOr send "all" to update fields one by one.`,
    senderType: 'bot',
  })
  return true
}

// ============================================================
// Sold Price Reveal Handler
// ============================================================

export async function handleSoldPriceReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const { data: property } = await supabaseAdmin()
      .from('properties')
      .select('title, sold_price')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!property) {
      console.error('[webhook] Property not found for sold price reply:', propertyId)
      return
    }

    let currency = 'INR'
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle()
    if (settings?.currency) {
      currency = settings.currency
    }

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'text',
      text: buildSoldPriceReply(
        (property.title as string) || 'This property',
        property.sold_price as number | null,
        currency
      ),
      senderType: 'bot',
    })
  } catch (err) {
    console.error('[webhook] Failed in handleSoldPriceReply:', err)
  }
}

// ============================================================
// Show More Properties Handler
// ============================================================

export async function handleShowMoreProperties(
  currentPropertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    // Get current property to find similar ones
    const { data: currentProperty } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('id', currentPropertyId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!currentProperty) {
      console.error('[webhook] Current property not found for show more:', currentPropertyId)
      return
    }

    // Find similar properties based on type, location, or price range
    const price = Number(currentProperty.price) || 0
    const minPrice = price * 0.7 // 30% below
    const maxPrice = price * 1.3 // 30% above

    const { data: similarProperties, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_published', true)
      .neq('id', currentPropertyId) // Exclude current property
      .or(`type.eq.${currentProperty.type},and(price.gte.${minPrice},price.lte.${maxPrice})`)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error || !similarProperties || similarProperties.length === 0) {
      // No similar properties, fall back to browse all
      await handleBrowseAllProperties(
        accountId,
        configOwnerUserId,
        contactId,
        conversationId,
        toPhone
      )
      return
    }

    // Send properties one by one
    let currency = 'INR'
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle()
    if (settings?.currency) {
      currency = settings.currency
    }

    // Send intro message
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'text',
      text: `Here are ${similarProperties.length} similar properties you might like:`,
      senderType: 'bot',
    })

    // Send each property
    for (const prop of similarProperties) {
      const typedProp = prop as PropertyRow
      
      const amount = Number(typedProp.price)
      let formattedPrice = ''
      if (!isNaN(amount) && amount > 0) {
        if (currency === 'INR') {
          if (amount >= 10000000) {
            formattedPrice = `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
          } else if (amount >= 100000) {
            formattedPrice = `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
          } else {
            formattedPrice = new Intl.NumberFormat('en-IN', {
              style: 'currency',
              currency: 'INR',
              maximumFractionDigits: 0,
            }).format(amount)
          }
        } else {
          formattedPrice = new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currency,
            maximumFractionDigits: 0,
          }).format(amount)
        }
      }

      const isLand = typedProp.type?.includes('Land') || typedProp.type?.includes('Plot')
      const areaVal = isLand ? typedProp.land_area : typedProp.area_sqft
      const unitVal = isLand ? typedProp.land_area_unit : typedProp.area_unit
      const areaStr = areaVal ? `${areaVal} ${unitVal || 'Sq.Ft.'}` : ''

      const locationParts =
        [
          typedProp.sublocality?.trim(),
          typedProp.city?.trim()
        ].filter(Boolean).join(', ') ||
        (isLocationGuarded({
          type: typedProp.type || '',
          location_privacy: typedProp.location_privacy,
        })
          ? ''
          : typedProp.location)

      // Account showcase + property code, as the manual share builds.
      // v= attributes Showcase Pulse engagement to this contact (never filters)
      const showcaseUrl = await accountPropertyShowcaseUrl(
        supabaseAdmin(),
        accountId,
        typedProp,
        contactId,
      )

      // Send image first
      const firstImage = typedProp.images?.find((img: string) => img.trim().length > 0)
      if (firstImage) {
        await sendWhatsAppMessageAndPersist({
          accountId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
          toPhone,
          kind: 'media',
          mediaKind: 'image',
          mediaLink: firstImage,
          mediaCaption: typedProp.title,
          senderType: 'bot',
        })
      }

      // Send details
      let detailsText = `🏠 *${typedProp.title}*\n`
      if (formattedPrice) detailsText += `💰 *Price:* ${formattedPrice}\n`
      if (locationParts) detailsText += `📍 *Location:* ${locationParts}\n`
      if (areaStr) detailsText += `📐 *Area:* ${areaStr}\n`
      if (typedProp.bedrooms) detailsText += `🛏️ *BHK:* ${typedProp.bedrooms} BHK\n`
      detailsText += `\n👇 *Click the link below to view photos, location map, and full details:*\n${showcaseUrl}`

      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId,
        conversationId,
        toPhone,
        kind: 'text',
        text: detailsText,
        senderType: 'bot',
      })
    }

    // Final follow-up with options
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: `Would you like to see more properties or get in touch?`,
      interactiveButtons: [
        { id: `show_more_properties:${similarProperties[similarProperties.length - 1].id}`, title: 'Show More' },
        { id: 'browse_all_properties', title: 'Browse All' },
      ],
      senderType: 'bot',
    })

    console.log(`[webhook] Sent ${similarProperties.length} similar properties to contact ${contactId}`)
  } catch (err) {
    console.error('[webhook] Failed in handleShowMoreProperties:', err)
  }
}
