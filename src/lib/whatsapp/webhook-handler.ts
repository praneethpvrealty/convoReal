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
} from '@/lib/whatsapp/listing-feedback'
import {
  handleBudgetBandReply,
  BUDGET_BAND_ID_PREFIX,
} from '@/lib/whatsapp/budget-band'
import {
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
      content_type: message.type === 'sticker' ? 'image' : message.type,
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
        assigned_agent_id: routingResult.agentId,
        assigned_team_id: routingResult.teamId,
        routing_rule_used: routingResult.ruleUsed,
        assigned_at: new Date().toISOString(),
      }
    }
  }

  // Click-to-WhatsApp ad attribution: if this message came from an
  // Instagram/Facebook ad, record the referral and stamp the contact.
  // Runs after routing (so routing still sees the pre-existing source)
  // and before the text matcher below — a property linked from the
  // actual ad we created is authoritative, so we skip text matching
  // when it succeeds. No-op for every non-ad message.
  let ctwaLinkedPropertyId: string | null = null
  if (message.referral) {
    const ctwaResult = await processCtwaReferral({
      admin: supabaseAdmin(),
      accountId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      messageId: message.id,
      referral: message.referral,
      contact: contactRecord,
    })
    ctwaLinkedPropertyId = ctwaResult.linkedPropertyId
  }

  // The listing this message is about, when its code or title names one
  // — the showcase's enquiry button always does. Hoisted so the
  // new-lead alert below can send the enquiry card instead of a generic
  // "someone messaged you".
  let enquiryPropertyId: string | null = null
  // The property CODE appearing in the message is a deliberate enquiry
  // — nothing puts "PROP-1030" in a buyer's message except the showcase
  // CTA or the buyer copying it on purpose. A TITLE appearing is much
  // weaker: any chat about a listing contains its title.
  let enquiryByCode = false
  let enquiryPropertyTitle: string | null = null
  if (contentText && !ctwaLinkedPropertyId) {
    try {
      const { data: properties } = await supabaseAdmin()
        .from('properties')
        .select('id, title, property_code')
        .eq('account_id', accountId)
        .eq('is_published', true);

      if (properties) {
        const textLower = contentText.toLowerCase();
        const matchedProperty = properties.find((p: { id: string; title: string; property_code?: string }) => {
          const titleMatches = textLower.includes(p.title.toLowerCase());
          const codeMatches = p.property_code ? textLower.includes(p.property_code.toLowerCase()) : false;
          if (codeMatches) enquiryByCode = true
          return titleMatches || codeMatches;
        });

        if (matchedProperty) {
          enquiryPropertyId = matchedProperty.id
          enquiryPropertyTitle = matchedProperty.title
          await supabaseAdmin()
            .from('contacts')
            .update({
              last_inquired_property_id: matchedProperty.id,
              status: 'pending_review',
              classification: contactRecord.classification === 'Others' ? 'Buyer' : contactRecord.classification,
              updated_at: new Date().toISOString()
            })
            .eq('id', contactRecord.id);
          console.log(`[webhook] Linked contact ${contactRecord.id} to property ${matchedProperty.id} and set to pending_review`);
        }
      }
    } catch (err) {
      console.error('[webhook] Failed to match property from text:', err);
    }
  }

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  void mediaType

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    if (msgError.code === '23505') {
      console.log(`[webhook] Message with ID ${message.id} has already been processed (deduplicated).`);
      return;
    }
    console.error('Error inserting message:', msgError)
    return;
  }

  // The account owner texting their own Engine number (the WhatsApp
  // lister/self-chat) is not a lead: keep that thread archived and
  // unread-free so it never surfaces in the shared inbox. Checked
  // here (before the conversation update) and reused below for the
  // owner chatbot routing.
  const ownerCheck = await checkIsAccountOwner(senderPhone, accountId)

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(ownerCheck.isOwner
        ? { unread_count: 0, is_archived: true }
        : {
            unread_count: (conversation.unread_count || 0) + 1,
            awaiting_reply: true,
            last_customer_message_at: new Date(
              parseInt(message.timestamp) * 1000
            ).toISOString(),
          }),
      ...routingUpdate,
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  // A staff member quote-replying one of our agent pings is answering
  // the lead that ping was about — send it on and stop, so the text
  // never also lands in the owner chatbot or the digest commands.
  // No-op for every message that isn't a reply to a bridge message.
  //
  // EXCEPT a button we put there ourselves. Tapping Approve on an
  // owner-queue ping arrives as a reply carrying that ping's
  // context.id, so the bridge matched it and relayed "✅ Approve" to
  // the lead-reply reader, which answered the owner with "couldn't
  // match the client to a contact in your book" — and the approval
  // never ran, because its handler sits further down this function.
  // A control payload is an instruction to the Engine, not a reply to
  // a lead, so the bridge has to stand down for it.
  const isControlReply = Boolean(
    interactiveReplyId && isEngineControlReplyId(interactiveReplyId)
  )

  // Run the control payload HERE, before any natural-language path can
  // claim it. Two of them sit between this point and the dispatch that
  // used to run these: the reply bridge just below, and the owner
  // chatbot further down. The owner chatbot is the one that fired, in
  // production, twice — the ping goes to the account holder, so the tap
  // comes FROM the owner, whose messages it intercepts by design. It
  // read "✅ Approve" as a forwarded client conversation, answered
  // "couldn't match the client to a contact in your book", and returned
  // handled, while the approval sat 460 lines below, unreached.
  //
  // A button the Engine minted is unambiguous: it is an instruction,
  // and no amount of intent parsing can improve on knowing that. So it
  // is dispatched before anything gets a chance to interpret it.
  if (isControlReply && interactiveReplyId) {
    if (
      interactiveReplyId.startsWith(CONSENT_APPROVE_PREFIX) ||
      interactiveReplyId.startsWith(CONSENT_DECLINE_PREFIX)
    ) {
      const handled = await handleLocationConsentReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      })
      if (handled) return
    }
    if (
      interactiveReplyId.startsWith(OWNER_APPROVE_PREFIX) ||
      interactiveReplyId.startsWith(OWNER_REJECT_PREFIX)
    ) {
      const handled = await handleOwnerLocationReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      })
      if (handled) return
    }
    // A tap on the enquiry card. It arrives in the AGENT's thread but
    // every action operates on the BUYER's, which is why both ids ride
    // in the button — see enquiry-card.ts.
    const enquiryAction = parseEnquiryReply(interactiveReplyId)
    if (enquiryAction) {
      const handled = await handleEnquiryCardReply(
        enquiryAction,
        accountId,
        configOwnerUserId,
        { contactId: contactRecord.id, conversationId: conversation.id },
      )
      if (handled) return
    }
  }

  const bridged = isControlReply
    ? false
    : await handleBridgedAgentReply({
        message,
        contentText,
        accountId,
        senderPhone,
        agentContactId: contactRecord.id,
        agentConversationId: conversation.id,
      })
  if (bridged) return

  // The agent this lead is routed to (freshly resolved above, or a prior
  // assignment), falling back to the account owner. Used to target
  // booking + new-lead notifications at the right person.
  const assignedAgentUserId =
    routingUpdate.assigned_agent_id ||
    (conversation as { assigned_agent_id?: string | null }).assigned_agent_id ||
    configOwnerUserId

  // A deliberate enquiry — the property CODE is in the message, which
  // nothing produces except the showcase's Enquire button or a buyer
  // quoting the code on purpose. This is a request for one listing, not
  // a requirement to qualify: the first live tap of the button was
  // answered by the ladder with "what budget range are you working
  // with?" — interrogating a buyer who had just named the exact
  // property — and no card reached the agent, because the card was
  // gated on the contact's first-ever message and this buyer had
  // messaged before. Buyer gets an acknowledgement, the agent gets the
  // Approve/Reject card, and the message is consumed so nothing
  // downstream can talk over the approval.
  if (
    !ownerCheck.isOwner &&
    enquiryPropertyId &&
    enquiryByCode &&
    message.type === 'text'
  ) {
    const preview = (contentText || '').slice(0, 140)
    const cardSent = await sendPropertyEnquiryCard({
      db: supabaseAdmin(),
      accountId,
      agentUserId: assignedAgentUserId,
      propertyId: enquiryPropertyId,
      contactId: contactRecord.id,
      leadName: contactRecord.name || senderPhone,
      leadPhone: senderPhone,
      enquiryText: preview,
    })

    await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'property_enquiry',
      title: `Enquiry: ${contactRecord.name || senderPhone}`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
      // The card is the WhatsApp ping. Only when it could not be
      // delivered does the plain text one stand in for it — and the
      // channel has to be forced off, not merely left without a text:
      // createNotification falls back to title+body on WhatsApp, which
      // put a second "Enquiry: …" bubble under the card on the very
      // first live run.
      ...(cardSent
        ? { channels: { inApp: true, push: true, whatsapp: false } }
        : {
            whatsappText: [
              '🔔 *New property enquiry*',
              `👤 ${contactRecord.name || senderPhone}`,
              '',
              preview,
              '',
              BRIDGE_REPLY_HINT,
            ].join('\n'),
          }),
    })

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: buildEnquiryAckText(contactRecord.name, enquiryPropertyTitle),
    })
    return
  }

  // First message on a brand-new lead thread — alert the assigned agent
  // once (in-app + push + WhatsApp).
  let pingedOnWhatsApp = false
  if (!ownerCheck.isOwner && isFirstInboundMessage) {
    const preview = (contentText || `[${message.type}]`).slice(0, 140)

    // A first message that names a listing is an enquiry, and an
    // enquiry deserves the card — property, buyer, and the two sends
    // the buyer is asking for — rather than a line of text the agent
    // has to read and act on by hand. Falls back to the plain ping when
    // no listing is named or the card cannot be delivered.
    const cardSent = enquiryPropertyId
      ? await sendPropertyEnquiryCard({
          db: supabaseAdmin(),
          accountId,
          agentUserId: assignedAgentUserId,
          propertyId: enquiryPropertyId,
          contactId: contactRecord.id,
          leadName: contactRecord.name || senderPhone,
          leadPhone: senderPhone,
          enquiryText: preview,
        })
      : false

    const notified = await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'first_inbound_message',
      title: `New lead: ${contactRecord.name || senderPhone}`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
      // The card already reached them on WhatsApp; a second message
      // saying the same thing less usefully is noise. The channel is
      // forced off rather than left without a text, because
      // createNotification falls back to title+body on WhatsApp. The
      // in-app and push notifications still go out either way.
      ...(cardSent
        ? { channels: { inApp: true, push: true, whatsapp: false } }
        : {
            whatsappText: [
              '💬 *New lead just messaged you*',
              `👤 ${contactRecord.name || senderPhone}`,
              '',
              preview,
              '',
              BRIDGE_REPLY_HINT,
            ].join('\n'),
          }),
    })
    pingedOnWhatsApp = cardSent || notified.whatsapp?.success === true
  } else if (!ownerCheck.isOwner && (conversation.unread_count || 0) === 0) {
    // A reply on an existing thread the agent had already caught up on
    // (unread was 0 before this message). Alert them with an in-app +
    // push notification — but not a WhatsApp ping, to avoid messaging
    // the agent for every back-and-forth. Threads that already had
    // unseen messages don't re-notify, so a burst of replies is one ping.
    const preview = (contentText || `[${message.type}]`).slice(0, 140)
    const notified = await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'inbound_reply',
      title: `${contactRecord.name || senderPhone} replied`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
    })
    pingedOnWhatsApp = notified.whatsapp?.success === true
  }

  // An agent who answered this lead from their own WhatsApp keeps the
  // conversation there: mirror the lead's message to their phone, ready
  // to be replied to again. Skipped when the notification above already
  // pinged them (that ping is itself answerable), and a no-op for every
  // thread nobody has answered from WhatsApp.
  if (!ownerCheck.isOwner && !pingedOnWhatsApp) {
    await relayLeadMessageToBridgedAgent({
      accountId,
      conversationId: conversation.id,
      leadName: contactRecord.name || senderPhone,
      body: contentText || `[${message.type}]`,
    })
  }

  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  if (message.type === 'button') {
    const consumed = await handleReminderButtonReply(
      message,
      accountId,
      contactRecord.id,
      conversation.id,
      configOwnerUserId
    )
    // A reminder tap is fully handled (stamp + ack + agent ping) —
    // don't let it fall through to digest parsing or the chatbots.
    if (consumed) return
  }

  // Completed native Meta Flow (form-screen) submission — e.g. the
  // Buyer Preference Intake form. The encrypted data-exchange endpoint
  // has usually already persisted the values at submit time; this path
  // is the idempotent fallback plus the in-chat confirmation.
  if (nfmResponseJson) {
    await handlePreferenceFlowNfmReply(
      nfmResponseJson,
      accountId,
      configOwnerUserId,
      contactRecord.id,
      conversation.id
    )
    return
  }

  // Owner digest subscription control — "STOP UPDATES" / "START UPDATES"
  // free text, or the digest template's "Pause updates" quick-reply
  // button (which arrives as message.button.text). The chat itself is
  // the owner's control panel: no login needed, works anytime.
  const digestCommand = parseOwnerDigestCommand(message.button?.text ?? contentText)
  if (digestCommand) {
    const confirmation = await applyOwnerDigestCommand({
      command: digestCommand,
      accountId,
      contactId: contactRecord.id,
    })
    if (confirmation) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: confirmation,
      })
      return
    }
  }

  // "Close my enquiry" on the enquiry-status / enquiry-followup
  // Buyer alert subscription control — "STOP ALERTS" / "START ALERTS"
  // free text, or either enquiry template's "Close my enquiry" quick
  // reply (which arrives as message.button.text). Same
  // chat-as-control-panel pattern as the owner digest commands above,
  // editing contacts.buyer_alerts_consent.
  //
  // "Still considering it" on the journey check-in template: the tap is
  // the client's answer — log it on the journey and ask for a timeline.
  //
  // Matched on the ACTION, so a lead who was sent the Kannada template
  // and taps "ಇನ್ನೂ ಪರಿಶೀಲಿಸುತ್ತಿದೆ" lands here too. What gets LOGGED is
  // still the English constant, so the journey reads one stable phrase
  // whatever language the client was messaged in.
  // The lead picking when to be checked back on, from the enquiry
  // timeline template. Matched on the action so any language lands
  // here; the journey item comes from their own latest logged
  // response, since a template quick reply carries no id to encode it.
  if (message.button?.text) {
    const handledTimeline = await handleTimelineTemplateTap({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: configOwnerUserId,
      contact: {
        id: contactRecord.id,
        name: contactRecord.name,
        phone: senderPhone,
      },
      conversationId: conversation.id,
      buttonText: message.button.text,
    })
    if (handledTimeline) return
  }

  if (matchTemplateButton(message.button?.text) === 'still_considering') {
    const keepOutcome = await handleInboxCheckinReply({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: configOwnerUserId,
      contact: {
        id: contactRecord.id,
        name: contactRecord.name,
        phone: senderPhone,
      },
      conversationId: conversation.id,
      responseText: JOURNEY_CHECKIN_KEEP_BUTTON,
      accessToken,
      phoneNumberId,
      fromButton: true,
    })
    if (keepOutcome !== 'logged_and_asked') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: "👍 Great — noted! We'll keep you posted.",
      })
    }
    return
  }

  // All three enquiry templates share one close action, and each one
  // ships in every language we send — so this matches on the ACTION,
  // resolved from the label in whatever language the lead received.
  // Comparing against the English constants (as this did) meant a
  // Kannada lead tapping "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" was not closing anything:
  // their enquiry stayed open and the alerts kept coming.
  const alertsCommand =
    matchTemplateButton(message.button?.text) === 'close_enquiry'
      ? 'close'
      : parseBuyerAlertsCommand(message.button?.text ?? contentText)
  if (alertsCommand) {
    const confirmation = await applyBuyerAlertsCommand({
      command: alertsCommand,
      accountId,
      contactId: contactRecord.id,
    })
    // 'close' is the lead saying the enquiry is over, not a preference
    // about alerts: it also marks the contact dead (migration 230),
    // which parks the requirement, stops every automated send and drops
    // them out of matching. The goodbye above still goes out — it is
    // the acknowledgement they asked for, and its one pitch to stay.
    if (alertsCommand === 'close') {
      await markContactDead({
        db: supabaseAdmin(),
        accountId,
        contactId: contactRecord.id,
        reason: 'closed_enquiry',
        note: 'Lead closed their enquiry from WhatsApp ("Close my enquiry")',
      })
    }
    if (confirmation) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: confirmation,
        // The contact was marked dead a line ago, which the dispatcher
        // refuses sends to. This one is the goodbye they asked for
        // rather than outreach, so it is the exception.
        allowDeadContact: alertsCommand === 'close',
      })
      // START ALERTS opened a free-form window at the lead's moment of
      // highest intent. Consent alone would waste it: run the first
      // missing rung of the tap ladder, or prove the saved profile
      // with matches when it is already complete.
      if (alertsCommand === 'start') {
        await sendAlertsOnboarding({
          db: supabaseAdmin(),
          accountId,
          userId: configOwnerUserId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
        })
      }
      return
    }
  }

  // On-demand matches — "MATCHES" / "show my matches" in the buyer's
  // chat. They just opened the 24-hour window by texting, so the reply
  // is free-form: no template, nothing to get approved first. Falls
  // through when the buyer has no brief or nothing fits.
  // A template quick reply arrives as message.button.text rather than
  // as message text, so read both — otherwise a tap that plainly says
  // "send listings" would fall through to generic handling.
  if (parseBuyerMatchesCommand(message.button?.text ?? contentText)) {
    const matchReply = await buildBuyerMatchReply({
      accountId,
      contactId: contactRecord.id,
    })
    if (matchReply) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: matchReply,
      })
      return
    }
  }

  // Quick replies on the Engine's own property and inventory templates.
  // The tap opens the 24-hour window, so every answer below is
  // free-form. Without these the buttons were dead ends: a lead who
  // tapped "Send more details" got silence.
  const templateQuickReply = parseTemplateQuickReply(
    message.button?.text ?? contentText,
  )
  if (templateQuickReply) {
    const admin = supabaseAdmin()
    if (templateQuickReply === 'property_details') {
      const propertyId = await lastSharedPropertyId(
        admin,
        accountId,
        contactRecord.id,
      )
      if (propertyId) {
        // Same photo + full-details message the interactive "Yes"
        // reply sends, so the lead sees one consistent answer.
        await handlePropertyShareYesReply(
          propertyId,
          accountId,
          configOwnerUserId,
          contactRecord.id,
          conversation.id,
          senderPhone,
        )
        return
      }
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: DETAILS_FALLBACK_TEXT,
      })
      return
    }

    if (templateQuickReply === 'inventory_full_list') {
      const fullList = await buildFullListMessage(admin, accountId)
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: fullList ?? DETAILS_FALLBACK_TEXT,
      })
      return
    }

    // site_visit — a scheduling request is a person's job, so the lead
    // gets an acknowledgement and the assigned agent gets pinged.
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: SITE_VISIT_ACK_TEXT,
    })
    await createNotification({
      accountId,
      userId:
        (conversation as { assigned_agent_id?: string | null }).assigned_agent_id ||
        configOwnerUserId,
      type: 'new_message',
      title: `Site visit requested: ${contactRecord.name || senderPhone}`,
      body: 'Tapped "Book a site visit" on a WhatsApp template.',
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
    })
    return
  }

  // Seller listing funnel: a message carrying a web-submission code is
  // the reverse-verification step — process it and stop (don't fall
  // through to the owner/external chatbot flows). No-op for every other
  // message, so existing behavior is unchanged when there's no code.
  if (contentText) {
    const handledListingVerification = await processListingVerification({
      accountId,
      contentText,
      senderPhone,
      contactRecord: { id: contactRecord.id, classification: contactRecord.classification },
      conversationId: conversation.id,
    })
    if (handledListingVerification) return
  }

  // Co-broker requirement replies: a message quoting REQ-XXXX from a
  // shared requirement (backed by a live share link) reveals the brief
  // and opens an external listing intake session for it. Never for the
  // account owner, and a no-op for every other message.
  if (contentText && !ownerCheck.isOwner) {
    const handledRequirementReply = await processRequirementReply({
      accountId,
      contentText,
      senderPhone,
      contactRecord: { id: contactRecord.id, classification: contactRecord.classification },
      conversationId: conversation.id,
    })
    if (handledRequirementReply) return
  }

  if (ownerCheck.isOwner) {
    console.log(`[webhook] Intercepted message from Engine owner: ${senderPhone}`)
    const handled = await processOwnerChatbotMessage(
      message,
      contentText,
      contactRecord,
      conversation,
      ownerCheck.accountId || accountId,
      ownerCheck.userId || configOwnerUserId,
      accessToken,
      phoneNumberId
    )
    if (handled) {
      return
    }
  }

  if (!ownerCheck.isOwner) {
    const { data: externalListingSession } = await supabaseAdmin()
      .from('property_draft_sessions')
      .select('id')
      .eq('contact_id', contactRecord.id)
      .eq('session_mode', 'external')
      .maybeSingle()

    if (externalListingSession) {
      console.log(`[webhook] Intercepted message for active external listing session: ${senderPhone}`)
      const handled = await processExternalListingMessage(
        message,
        contentText,
        contactRecord,
        conversation,
        accountId,
        accessToken,
        phoneNumberId
      )
      if (handled) {
        return
      }
    }

    // A text reply to a journey check-in the agent sent from the Engine
    // inbox ("just checking in on <property>..."). Logged on the journey
    // either way; the message is only consumed when the timeline ask
    // went out — a reply that reads as a question still falls through
    // so the bot answers it.
    if (message.type === 'text' && contentText) {
      const checkinOutcome = await handleInboxCheckinReply({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        contact: {
          id: contactRecord.id,
          name: contactRecord.name,
          phone: senderPhone,
        },
        conversationId: conversation.id,
        responseText: contentText,
        accessToken,
        phoneNumberId,
      })
      if (checkinOutcome === 'logged_and_asked') return
    }

    // A lead answering "what are your requirements and budget?" — the
    // question the lead-sync auto-reply ends with. Files the answer on
    // the contact and replies with the next missing qualifier or the
    // matching listings. No-op for accounts with auto_qualify_leads off,
    // for non-buyers, and for messages that carry no requirement.
    if (message.type === 'text') {
      const qualified = await processBuyerQualificationMessage(
        contentText,
        contactRecord,
        conversation,
        accountId,
        accessToken,
        phoneNumberId,
        configOwnerUserId,
        message.id
      )
      if (qualified) return
    }
  }

  if (message.type === 'contacts' && message.contacts && message.contacts.length > 0) {
    console.log(`[webhook] Shared contacts message detected from: ${senderPhone}`)
    
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const importedNames: string[] = []

    for (const c of message.contacts) {
      let name = c.name?.formatted_name || '';
      let phone = '';
      let email = '';

      if (c.vcard) {
        const fnMatch = c.vcard.match(/FN:(.+)/i);
        if (fnMatch) name = fnMatch[1].trim();

        const telMatch = c.vcard.match(/TEL(?:;[^:]*)?:(.+)/i);
        if (telMatch) phone = telMatch[1].trim();

        const emailMatch = c.vcard.match(/EMAIL(?:;[^:]*)?:(.+)/i);
        if (emailMatch) email = emailMatch[1].trim();
      }

      if (!phone && c.phones && c.phones.length > 0) {
        phone = c.phones[0].phone;
      }
      if (!email && c.emails && c.emails.length > 0) {
        email = c.emails[0].email;
      }

      if (!phone) continue;

      const normalizedImportPhone = normalizePhoneWithCountryCode(phone);
      if (!normalizedImportPhone) continue;

      const cleanPhone = normalizedImportPhone.replace(/\D/g, '');
      const { data: existingContact } = await supabaseAdmin()
        .from('contacts')
        .select('id, name')
        .eq('account_id', accountId)
        .or(`phone.eq.${normalizedImportPhone},phone.eq.${cleanPhone}`)
        .maybeSingle();

      if (!existingContact) {
        // Forwarded phonebook cards carry the agent's quick-reference names
        // ("Nataraj Bank DSA") — split the qualifier into the Engine-only Name
        // Tag so outbound messages use the clean name.
        const nameSplit = name ? suggestNameTagSplit(name) : null;
        const { error: insertErr } = await supabaseAdmin()
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: configOwnerUserId || null,
            name: nameSplit?.name ?? (name || `Contact ${normalizedImportPhone}`),
            name_tag: nameSplit?.nameTag ?? null,
            phone: normalizedImportPhone,
            email: email || null,
            classification: 'Others',
            company: '',
            status: 'pending_review',
            source: 'WhatsApp',
          });

        if (insertErr) {
          console.error('[webhook] Failed to auto-insert shared contact:', insertErr);
        } else if (nameSplit) {
          importedNames.push(`${nameSplit.name} — 🏷️ ${nameSplit.nameTag}`);
        } else {
          importedNames.push(name || normalizedImportPhone);
        }
      } else {
        importedNames.push(`${existingContact.name} (already in ${BRANDING.name})`);
      }
    }

    if (importedNames.length > 0) {
      let replyText = `📥 *Contact Import Status:*\n\n`
      importedNames.forEach((n, idx) => {
        replyText += `✅ ${idx + 1}. *${n}*\n`
      })
      
      replyText += `\nClick here to complete classification and details:\n${baseUrl}/contacts`

      try {
        const sendRes = await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: senderPhone,
          text: replyText,
        });

        const { data: botMsg } = await supabaseAdmin().from('messages').insert({
          conversation_id: conversation.id,
          sender_type: 'bot',
          content_type: 'text',
          content_text: replyText,
          message_id: sendRes.messageId,
          status: 'sent',
          created_at: new Date().toISOString(),
        }).select('id').single();

        if (botMsg) {
          await supabaseAdmin().from('conversations').update({
            last_message_text: replyText,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            awaiting_reply: false,
          }).eq('id', conversation.id);
        }
      } catch (err) {
        console.error('[webhook] Failed to send contact import confirmation auto-reply:', err);
      }
    }
  }

  // A lead asking to meet ("can we visit the JP Nagar flat Saturday 3pm?")
  // books the appointment on the agent's calendar. Runs before the
  // read-only calendar query below so a concrete date/time creates an
  // event instead of just listing existing ones; vague schedule talk
  // ("what visits do I have?") falls through untouched.
  // A question that happens to mention a day is not a booking request.
  // "Can we see inside when we visit tomorrow" parsed as a schedule and
  // re-acknowledged a visit already in the diary; it is a question about
  // access, and it belongs on the answer ladder below.
  // "Call me tomorrow at 5" carries a date and a time but asks for a
  // phone call, not a site visit — it belongs to the handover branch
  // below, the same way a question does.
  if (
    !ownerCheck.isOwner &&
    !looksLikeQuestion(contentText) &&
    !requestsHumanContact(contentText)
  ) {
    const booked = await tryHandleInboundScheduling({
      message,
      contentText,
      contactRecord,
      conversation,
      accountId,
      ownerUserId: configOwnerUserId,
      assignedAgentUserId,
      accessToken,
      phoneNumberId,
    })
    if (booked) return
  }

  const cleanedText = contentText?.trim()?.toLowerCase() || ''
  const isCalendarQuery = /\b(schedule|visit|appointment|appointments|booking|bookings|my visits|my appointments)\b/i.test(cleanedText)
  
  if (isCalendarQuery) {
    console.log(`[webhook] Calendar schedule query detected from contact: ${contactRecord.id} (${senderPhone})`)
    
    const nowIso = new Date().toISOString()
    const { data: appointments, error: apptError } = await supabaseAdmin()
      .from('appointments')
      .select('*, property:properties(title, location, sublocality)')
      .eq('contact_id', contactRecord.id)
      .eq('status', 'scheduled')
      .gte('start_time', nowIso)
      .order('start_time', { ascending: true })

    let replyText = ''
    if (apptError) {
      console.error('[webhook] Error fetching appointments for auto-reply:', apptError)
      replyText = `Sorry, I encountered an error checking your schedule. Please try again later or contact your agent.`
    } else if (!appointments || appointments.length === 0) {
      replyText = `Hi ${contactRecord.name || 'there'},\n\nYou have no upcoming property visits or appointments scheduled at the moment.`
    } else {
      replyText = `Hi ${contactRecord.name || 'there'},\n\nHere are your upcoming scheduled visits:\n\n`
      
      appointments.forEach((appt: {
        start_time: string;
        title: string;
        location?: string | null;
        property?: {
          title?: string | null;
          location?: string | null;
          sublocality?: string | null;
        } | null;
      }, idx: number) => {
        const dateStr = new Date(appt.start_time).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
        const propTitle = appt.property?.title ? `🏡 *${appt.property.title}*` : '🏡 *Property Details*'
        const locationStr = appt.location || appt.property?.location || appt.property?.sublocality || 'Not specified'
        
        replyText += `${idx + 1}. 📅 *${appt.title}*\n${propTitle}\n📍 Location: ${locationStr}\n⏰ Time: ${dateStr}\n\n`
      })
      
      replyText += `Please contact us if you need to reschedule any of these visits!`
    }

    try {
      const sendRes = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: senderPhone,
        text: replyText,
      })

      await supabaseAdmin().from('messages').insert({
        conversation_id: conversation.id,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        message_id: sendRes.messageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      })

      await supabaseAdmin()
        .from('conversations')
        .update({
          last_message_text: replyText,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          awaiting_reply: false,
        })
        .eq('id', conversation.id)

      console.log(`[webhook] Automated calendar reply successfully sent to ${senderPhone}`)
    } catch (sendErr) {
      console.error('[webhook] Failed to send automated calendar reply:', sendErr)
    }

    return
  }

  // Check for active update session
  const { data: activeUpdateSession } = await supabaseAdmin()
    .from('update_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .eq('status', 'collecting')
    .maybeSingle()

  if (
    activeUpdateSession &&
    (await isAuthorizedForUpdateSession(activeUpdateSession, contactRecord, senderPhone, accountId))
  ) {
    const handled = await handleUpdateSessionInput(
      activeUpdateSession.id,
      contentText || '',
      accountId,
      configOwnerUserId,
      contactRecord,
      conversation,
      senderPhone
    )
    if (handled) return
  }

  // A tap on the listing-feedback list. Handled before the preference
  // trigger below: the list's "Update preferences" row title would
  // otherwise match the free-text preference regex and re-run the
  // listings reply instead of sending the form the row promises.
  if (interactiveReplyId?.startsWith(LISTING_FEEDBACK_ID_PREFIX)) {
    const handledFeedback = await handleListingFeedbackReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    })
    if (handledFeedback) return
  }

  // A tap on the requirement playback card — confirm the brief, or
  // re-open the type/budget lists and the typed area question.
  if (interactiveReplyId?.startsWith(REQUIREMENT_TWEAK_ID_PREFIX)) {
    const handledTweak = await handleRequirementTweakReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    })
    if (handledTweak) return
  }

  // A tapped property type or budget band. The tap saves the answer;
  // the onboarding ladder then sends whichever rung is still missing,
  // or the re-ranked shortlist when the profile is complete — the
  // answer that makes tapping worth it.
  if (
    interactiveReplyId?.startsWith(PROPERTY_TYPE_ID_PREFIX) ||
    interactiveReplyId?.startsWith(BUDGET_BAND_ID_PREFIX)
  ) {
    const handledRung = interactiveReplyId.startsWith(PROPERTY_TYPE_ID_PREFIX)
      ? await handlePropertyTypeReply({
          db: supabaseAdmin(),
          accountId,
          contactId: contactRecord.id,
          replyId: interactiveReplyId,
        })
      : await handleBudgetBandReply({
          db: supabaseAdmin(),
          accountId,
          contactId: contactRecord.id,
          replyId: interactiveReplyId,
        })
    if (handledRung) {
      await sendAlertsOnboarding({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
      })
      return
    }
  }

  // Buyer asked to update their preferences (free text like "update my
  // preferences", the update_preferences button, or the enquiry-followup
  // template's "Update my preferences" quick reply, which arrives as
  // message.button.text) — send the native Meta Flow form if this
  // account has one published. Falls through to normal handling when
  // the flow isn't set up, so accounts without the feature see no
  // behavior change.
  if (
    isPreferenceFlowRequestText(message.button?.text ?? contentText) ||
    interactiveReplyId === PREFERENCE_FLOW_BUTTON_ID
  ) {
    const handledPreferenceFlow = await handlePreferenceFlowTrigger(
      accountId,
      contactRecord.id,
      configOwnerUserId,
      conversation.id
    )
    if (handledPreferenceFlow) return
  }

  // Check for update intent. Allowed for account staff (owner/admin/agent,
  // org_manager/org_leader) or the WhatsApp contact that owns the target
  // record (their own contact, or a property they listed). Unauthorized
  // senders fall through to normal handling so they cannot mutate records
  // and never learn the feature exists.
  const updateIntent = parseUpdateIntent(contentText || '')
  if (updateIntent && updateIntent.type) {
    const handledUpdate = await handleUpdateIntent(
      updateIntent as { type: 'property' | 'contact'; identifier?: string },
      accountId,
      configOwnerUserId,
      contactRecord,
      conversation,
      senderPhone
    )
    if (handledUpdate) return
  }

  if (interactiveReplyId) {
    if (interactiveReplyId.startsWith(CLIENT_FOLLOWUP_PREFIX)) {
      const handledFollowup = await handleClientFollowupReply({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        contact: {
          id: contactRecord.id,
          name: contactRecord.name,
          phone: senderPhone,
        },
        conversationId: conversation.id,
        replyId: interactiveReplyId,
      })
      if (handledFollowup) return
    }
    // Consent and owner decisions are dispatched far earlier, before
    // the reply bridge and the owner chatbot can interpret them.
    if (interactiveReplyId.startsWith('share_property_yes:')) {
      const propertyId = interactiveReplyId.split(':')[1]
      await handlePropertyShareYesReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    } else if (interactiveReplyId.startsWith('share_property_no:')) {
      const propertyId = interactiveReplyId.split(':')[1]
      await handlePropertyShareNoReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    } else if (interactiveReplyId.startsWith('show_more_properties:')) {
      const propertyId = interactiveReplyId.split(':')[1]
      await handleShowMoreProperties(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    } else if (interactiveReplyId === 'browse_all_properties') {
      await handleBrowseAllProperties(
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    } else if (interactiveReplyId.startsWith(SOLD_PRICE_BUTTON_PREFIX)) {
      const propertyId = interactiveReplyId.slice(SOLD_PRICE_BUTTON_PREFIX.length)
      await handleSoldPriceReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    } else if (interactiveReplyId.startsWith(SOLD_SIMILAR_BUTTON_PREFIX)) {
      const propertyId = interactiveReplyId.slice(SOLD_SIMILAR_BUTTON_PREFIX.length)
      await handleShowMoreProperties(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    }
  }

  // A property owner (owner-ish classification, digest targeting, or an
  // actual listing linked to their contact) replying to us must never be
  // greeted by a buyer-intake flow ("let's find your dream property").
  // Suppress flow ENTRY for them — active runs still advance — and
  // answer their free text below with a reply grounded in their own
  // listings instead.
  let ownedListings: OwnedListing[] = []
  if (isOwnerContact(contactRecord)) {
    ownedListings = await findOwnedListings(accountId, contactRecord.id)
  }
  const isPropertyOwnerSender = ownedListings.length > 0

  // A human agent already talking to this lead owns the conversation:
  // suppress flow ENTRY so a stray keyword cannot restart the welcome
  // funnel underneath them. Active runs still advance — the lead is
  // mid-answer and expects the next question.
  const agentHandling = await hasRecentAgentReply(supabaseAdmin(), conversation.id)
  if (agentHandling) {
    // A run that outlived the send-time pause would keep answering the
    // lead "Sorry, I didn't quite catch that" through a live
    // negotiation. Stand it down before dispatch, so this message
    // reaches the agent instead of the funnel.
    const stoodDown = await standDownActiveFlowRuns(
      supabaseAdmin(),
      accountId,
      contactRecord.id,
    )
    if (stoodDown > 0) {
      console.log(
        `[webhook] Stood down ${stoodDown} flow run(s) — an agent is handling this thread`,
      )
    }
  }

  console.log(`[webhook] Dispatching to flows. accountId=${accountId}, contact=${contactRecord.id}, text="${contentText ?? message.text?.body ?? ''}"`);
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    allowEntry: !isPropertyOwnerSender && !agentHandling,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  console.log(`[webhook] Flow result: consumed=${flowResult.consumed}, outcome=${flowResult.outcome || 'n/a'}, flow_run_id=${flowResult.flow_run_id || 'n/a'}`);
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? message.text?.body ?? ''

  if (
    !flowConsumed &&
    isPropertyOwnerSender &&
    (message.type === 'text' || message.type === 'button')
  ) {
    const ownerHandled = await handleOwnerInboundMessage({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      contactName: contactRecord.name || null,
      conversationId: conversation.id,
      digestConsent: contactRecord.owner_digest_consent,
      text: message.button?.text ?? inboundText,
      listings: ownedListings,
    })
    if (ownerHandled) return
  }

  // A lead's question nothing above claimed. Answer it from the listing
  // they were last sent — free fields first, then Gemini grounded in
  // those same fields — and when neither can, say so and put a person
  // on it rather than guessing or going quiet.
  if (
    !flowConsumed &&
    !ownerCheck.isOwner &&
    !isPropertyOwnerSender &&
    message.type === 'text' &&
    (looksLikeQuestion(inboundText) ||
      requestsHumanContact(inboundText) ||
      // "Sir can I get images" is not question-shaped either, but it
      // asks for the listing's own photos, which we hold.
      requestsPropertyPhotos(inboundText) ||
      // "Option 2" is not question-shaped, but the shortlist that
      // numbered it closed with "reply with the number", so it is an
      // answer to us and it is about one listing.
      parseOrdinalReferences(inboundText).length > 0)
  ) {
    const admin = supabaseAdmin()
    // Plural: a buyer who asks about "options 1 & 2" asked two
    // questions, and answering only the first leaves the second
    // hanging on a listing they had already numbered for us.
    const subjects = await questionSubjectProperties(
      admin,
      accountId,
      contactRecord.id,
      conversation.id,
      inboundText,
    )

    // A photo request is answered with the photos themselves, not with
    // prose about them. When they cannot be sent — no listing pinned to
    // the thread, or a gallery the confidential switch emptied — the
    // handover below promises them and summons the person who has them.
    // A lead asking to be called stays with the callback branch even
    // when photos are mentioned: a person was requested, so a person
    // answers.
    const photoRequest =
      requestsPropertyPhotos(inboundText) && !requestsHumanContact(inboundText)
    let answer: LeadAnswer
    if (photoRequest) {
      const sentPhotos = await sendSubjectPhotos({
        db: admin,
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        propertyIds: subjects.map((s) => s.id),
        requestText: inboundText,
      })
      if (sentPhotos) return
      answer = {
        text: photoHandoverText(subjects[0]?.title),
        source: 'handover',
      }
    } else {
      const { data: qaConfig } = await admin
        .from('whatsapp_config')
        .select('share_seller_final_price')
        .eq('account_id', accountId)
        .maybeSingle()
      const answers = await Promise.all(
        (subjects.length > 0 ? subjects : [null]).map(async (subject) =>
          answerLeadQuestion({
            accountId,
            question: inboundText,
            property: subject,
            shareSellerFinalPrice: qaConfig?.share_seller_final_price === true,
            portalListings: subject
              ? await subjectPortalListings(admin, accountId, subject.id)
              : [],
          }),
        ),
      )
      answer = mergeLeadAnswers(answers, subjects)
    }

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: answer.text,
    })

    if (answer.source === 'handover') {
      // The lead has been promised a person, so make sure one hears
      // about it: notification, the agent's own WhatsApp, and the
      // thread flagged for whoever is on duty.
      await createNotification({
        accountId,
        userId: assignedAgentUserId,
        type: 'new_message',
        title: `Question needs you: ${contactRecord.name || senderPhone}`,
        body: inboundText.slice(0, 140),
        entityType: 'conversation',
        entityId: conversation.id,
        link: `/inbox?conversation=${conversation.id}`,
      })
      await relayLeadMessageToBridgedAgent({
        accountId,
        conversationId: conversation.id,
        leadName: contactRecord.name || senderPhone,
        body: inboundText,
      })
      await admin
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
        .eq('account_id', accountId)
        .select('id')
    }
    return
  }

  // The buyer just messaged us, so their 24-hour window is open: the
  // one moment the alerts question can be asked free-form, needing no
  // template and no category. Soliciting an opt-in is Marketing by
  // Meta's test, so this is the only compliant place to ask — and it
  // reaches every buyer who ever replies, not just whoever happens to
  // be mid-chat when the daily digest runs.
  //
  // Not while an agent is mid-conversation, though: asking "want
  // alerts?" in the middle of a price negotiation is the bot talking
  // over the person actually closing the deal. It waits for a quieter
  // message — the buyer is never asked twice, so nothing is lost.
  if (!ownerCheck.isOwner && !isPropertyOwnerSender && !agentHandling) {
    try {
      const consentAsk = await claimBuyerConsentAsk(
        supabaseAdmin(),
        accountId,
        contactRecord as unknown as Contact,
        null,
        1,
      )
      if (consentAsk) {
        await sendWhatsAppMessageAndPersist({
          accountId,
          userId: configOwnerUserId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
          kind: 'text',
          senderType: 'bot',
          text: consentAsk,
        })
      }
    } catch (err) {
      console.error('[buyer-consent] ask failed (non-fatal):', err)
    }
  }

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    try {
      await runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
        },
      })
    } catch (err) {
      console.error('[automations] dispatch failed:', err)
    }
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  // accessToken no longer needed — media is proxied on demand
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
  /** Raw response_json of a completed native Meta Flow (nfm_reply). */
  nfmResponseJson: string | null
}> {
  const buildMediaUrl = (mediaId: string): string => {
    // Build the proxy URL without pre-verifying with Meta.
    // The /api/whatsapp/media/[mediaId] proxy already handles
    // unavailable or expired media IDs gracefully with a 404.
    return `/api/whatsapp/media/${mediaId}`
  }

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
    nfmResponseJson: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: buildMediaUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: buildMediaUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: buildMediaUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: buildMediaUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: buildMediaUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        // Emit the canonical Maps URL rather than a bare coordinate pair:
        // it renders as a tappable link in the inbox, and the listing
        // intake resolves it into the pin's locality/city/coordinates.
        const locationText = [
          loc.name,
          loc.address,
          googleMapsUrlForCoordinates(loc.latitude, loc.longitude),
        ]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'button':
      if (message.button) {
        return {
          ...empty,
          contentText: `🔘 Button: "${message.button.text}"`,
          // Template quick replies deliver their send-time payload here —
          // surfacing it as interactiveReplyId routes taps through the
          // same handlers as free-form interactive buttons. Payloads
          // without a registered prefix (Meta defaults them to the button
          // text) simply fall through unchanged.
          interactiveReplyId: message.button.payload || null,
        }
      }
      return { ...empty, contentText: '[Button message]' }

    case 'interactive': {
      if (message.interactive?.type === 'nfm_reply' && message.interactive.nfm_reply) {
        return {
          ...empty,
          contentText:
            message.interactive.nfm_reply.body || '📋 Form submitted',
          nfmResponseJson: message.interactive.nfm_reply.response_json,
        }
      }
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    case 'contacts': {
      if (message.contacts && message.contacts.length > 0) {
        const summaries = message.contacts.map((c) => {
          const name = c.name?.formatted_name || 'Shared Contact';
          const phones = c.phones?.map((p) => p.phone).join(', ') || '';
          return `${name} (${phones})`;
        });
        return {
          ...empty,
          contentText: `${SHARED_CARDS_HEADER}\n${summaries.join('\n')}`,
        };
      }
      return { ...empty, contentText: '📥 Shared Contact Card' };
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

interface ContactRow {
  id: string
  account_id: string
  user_id: string | null
  phone: string
  name: string
  classification?: string
  owner_digest_consent?: string | null
  owner_digest_consent_requested_at?: string | null
}

interface PropertyRow {
  id: string
  title: string
  price: number | string | null
  area_sqft: number | null
  area_unit: string | null
  bedrooms: number | null
  type?: string | null
  land_area?: number | null
  land_area_unit?: string | null
  sublocality?: string | null
  city?: string | null
  state?: string | null
  location?: string | null
  location_privacy?: string | null
  description?: string | null
  google_map_link?: string | null
  images?: string[] | null
  bathrooms?: number | null
}

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const normalizedSender = phone.replace(/\D/g, '')
  const phoneSuffix =
    normalizedSender.length >= 8
      ? normalizedSender.slice(-8)
      : normalizedSender

  // is_merged excluded so a merge winner always claims the thread — the
  // arbitrary pick among duplicates here is what let two contacts on one
  // number keep trading the same sender's messages between their threads.
  const { data: contacts, error: contactsError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_merged', false)
    .like('phone', `%${phoneSuffix}`)

  if (contactsError) {
    console.error('Error fetching contacts:', contactsError)
    return null
  }

  const existingContact = contacts?.find((c: ContactRow) => phonesMatch(c.phone, phone))

  if (existingContact) {
    // Only adopt the sender's WhatsApp profile name when the contact has
    // no real name yet (blank, or still just the phone number). A name the
    // user saved by hand must never be clobbered by the sender's own
    // WhatsApp display name — instead record that display name as a note
    // (once) so the information isn't lost.
    const storedName = (existingContact.name || '').trim()
    const phoneDigits = phone.replace(/\D/g, '')
    const isPlaceholderName = !storedName || storedName.replace(/\D/g, '') === phoneDigits

    if (name && name !== existingContact.name) {
      if (isPlaceholderName) {
        await supabaseAdmin()
          .from('contacts')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', existingContact.id)
        existingContact.name = name
      } else if (name.replace(/\D/g, '') !== phoneDigits) {
        await recordWhatsAppProfileName(accountId, configOwnerUserId, existingContact.id, name)
      }
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      source: 'WhatsApp',
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

/** Log the sender's current WhatsApp profile name against a contact whose
 *  name the user set by hand, so the display name is captured without
 *  overwriting the saved name. Deduped on the exact note text so it isn't
 *  re-added on every inbound message. */
async function recordWhatsAppProfileName(
  accountId: string,
  userId: string,
  contactId: string,
  profileName: string
): Promise<void> {
  const noteText = `WhatsApp profile name: ${profileName}`
  const { data: existing } = await supabaseAdmin()
    .from('contact_notes')
    .select('id')
    .eq('contact_id', contactId)
    .eq('note_text', noteText)
    .limit(1)
  if (existing && existing.length > 0) return
  await supabaseAdmin().from('contact_notes').insert({
    contact_id: contactId,
    account_id: accountId,
    user_id: userId,
    note_text: noteText,
  })
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { conversation, error } = await resolveConversation<ConversationRow>(supabaseAdmin(), {
    accountId,
    contactId,
    userId: configOwnerUserId,
  })

  if (error) {
    console.error('Error creating conversation:', error)
    return null
  }

  return conversation
}

export async function handlePropertyShareYesReply(
  propertyId: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string,
  toPhone: string
) {
  try {
    const { data: property, error } = await supabaseAdmin()
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle()

    const typedProperty = property as PropertyRow | null

    if (error || !typedProperty) {
      console.error('[webhook] Property not found for share yes reply:', propertyId, error)
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

    const amount = Number(typedProperty.price)
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

    const isLand = typedProperty.type?.includes('Land') || typedProperty.type?.includes('Plot')
    const areaVal = isLand ? typedProperty.land_area : typedProperty.area_sqft
    const unitVal = isLand ? typedProperty.land_area_unit : typedProperty.area_unit
    const areaStr = areaVal ? `${areaVal} ${unitVal || 'Sq.Ft.'}` : ''

    const propertyGuarded = isLocationGuarded({
      type: typedProperty.type || '',
      location_privacy: typedProperty.location_privacy,
    })
    const locationParts =
      [
        typedProperty.sublocality?.trim(),
        typedProperty.city?.trim()
      ].filter(Boolean).join(', ') ||
      (propertyGuarded ? '' : typedProperty.location)

    // The account's own showcase (its subdomain when it has one) and
    // the listing's property code — same link the manual share builds,
    // rather than an unbranded convoreal.com/?property_id=<uuid>.
    // v= attributes Showcase Pulse engagement to this contact (never filters)
    const showcaseUrl = await accountPropertyShowcaseUrl(
      supabaseAdmin(),
      accountId,
      typedProperty,
      contactId,
    )

    let detailsText = `🏠 *${typedProperty.title}*\n`
    if (formattedPrice) detailsText += `💰 *Price:* ${formattedPrice}\n`
    if (locationParts) detailsText += `📍 *Location:* ${locationParts}\n`
    if (areaStr) detailsText += `📐 *Area:* ${areaStr}\n`
    if (typedProperty.bedrooms) detailsText += `🛏️ *BHK:* ${typedProperty.bedrooms} BHK\n`
    if (typedProperty.bathrooms) detailsText += `🛁 *Bathrooms:* ${typedProperty.bathrooms}\n`
    if (typedProperty.description) detailsText += `\n📝 *Description:*\n${typedProperty.description}\n`

    if (typedProperty.google_map_link && !propertyGuarded) {
      detailsText += `\n🗺️ *Google Maps:* ${typedProperty.google_map_link}\n`
    }
    detailsText += `\n👇 *Click the link below to view photos, location map, and full details:*\n${showcaseUrl}`

    const firstImage = typedProperty.images?.find((img: string) => img.trim().length > 0)
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
        mediaCaption: `Showcase image for ${typedProperty.title}`,
        senderType: 'bot',
      })
    }

    // Send property details
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

    // Offer browse properties option
    const followUpText = `Would you like to explore other properties?`
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      toPhone,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: followUpText,
      interactiveButtons: [
        { id: `show_more_properties:${typedProperty.id}`, title: 'Show More Properties' },
        { id: 'browse_all_properties', title: 'Browse All' },
        { id: `share_property_no:${typedProperty.id}`, title: 'No Thanks' }
      ],
      senderType: 'bot',
    })

    console.log(`[webhook] Successfully shared property ${propertyId} with contact ${contactId}`)
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareYesReply:', err)
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

  await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
    kind: 'text',
    senderType: 'bot',
    text: summarizePreferenceUpdate(update),
  })

  // The summary above promises a match. Deliver it now, while the
  // window this submission just opened is still open — a re-engaged
  // lead who filled the form is the highest intent this funnel sees,
  // and it used to end here.
  await sendPreferenceMatchFollowUp({
    db: supabaseAdmin(),
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
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
