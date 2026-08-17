import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { standDownActiveFlowRuns } from '@/lib/whatsapp/agent-takeover'
import { storagePublicUrl } from '@/lib/storage/url'
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendProductMessage,
  sendFlowMessage,
  type MediaKind,
  type InteractiveButton,
  type InteractiveListSection,
  type FlowActionPayload,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveConversation } from '@/lib/conversations/resolve'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils'
import { getSandboxSystemConfig } from '@/lib/system-settings'
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isWithinCustomerWindow,
} from '@/lib/whatsapp/customer-window'
import { CHAIN_ONLY_BLOCKED_MESSAGE } from '@/lib/contacts/chain-only'
import { DEAD_CONTACT_BLOCKED_MESSAGE } from '@/lib/contacts/lifecycle'

/** Window within which an identical template to the same conversation is
 *  treated as a duplicate and skipped (double-submit / overlapping-trigger
 *  guard). */
const DUPLICATE_TEMPLATE_WINDOW_MS = 20_000

/** Only substantial free-text sends are dedup-guarded, so ordinary short
 *  replies ("ok", "hi") that a user may legitimately repeat are never
 *  collapsed. The property-details blast is well over this. */
const DUPLICATE_TEXT_MIN_LENGTH = 120

// Lazy initialize admin client fallback
let _adminClient: ReturnType<typeof createClient> | null = null
function defaultAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export interface SendWhatsAppAndPersistArgs {
  accountId: string
  userId?: string | null
  contactId?: string | null
  conversationId?: string | null
  toPhone?: string | null
  kind: 'text' | 'template' | 'media' | 'interactive' | 'product'
  senderType: 'user' | 'bot' | 'agent'
  text?: string | null
  templateName?: string | null
  templateLanguage?: string | null
  templateParams?: string[] | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageParams?: any | null // For broadcast structured messageParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  templateRow?: any | null // Pre-loaded template row context (useful for broadcasts)
  mediaKind?: MediaKind | null
  mediaLink?: string | null
  mediaCaption?: string | null
  mediaFilename?: string | null
  interactiveType?: 'buttons' | 'list' | 'flow' | null
  interactiveBody?: string | null
  interactiveButtons?: InteractiveButton[] | null
  interactiveButtonLabel?: string | null
  interactiveSections?: InteractiveListSection[] | null
  // Native Meta Flow fields (interactiveType 'flow')
  flowId?: string | null
  flowToken?: string | null
  flowCta?: string | null
  flowMode?: 'published' | 'draft' | null
  flowAction?: 'navigate' | 'data_exchange' | null
  flowActionPayload?: FlowActionPayload | null
  headerText?: string | null
  footerText?: string | null
  productCatalogId?: string | null
  productRetailerId?: string | null
  /** Meta's wamid of the quoted message — goes on the outgoing payload. */
  contextMessageId?: string | null
  /** Our `messages.id` for that same quoted message. Persisted as the
   *  row's `reply_to_message_id`, which is a UUID self-FK: writing a
   *  wamid there fails the insert after Meta has already sent. */
  replyToMessageId?: string | null
  /** Permits a send to a `chain_only` contact. Only the re-share
   *  consent chain may set this — it is the machinery that created
   *  those contacts and has to reach them. Everything else (broadcasts,
   *  automations, digests, an agent typing in the inbox) is refused, so
   *  a co-broker's downstream party is not reachable by the listing
   *  side just because the chain recorded them. */
  allowChainOnly?: boolean
  /** Permits a send to a dead or archived contact (migration 230).
   *  Only the inbox composer sets it: an agent typing a reply to a lead
   *  who closed their enquiry is a deliberate personal message, which
   *  the product allows. Every automated sender — broadcasts,
   *  automations, digests, Radar, shares — leaves it unset and is
   *  refused. */
  allowDeadContact?: boolean
  /** Marks a contact this call has to CREATE (toPhone with no existing
   *  match) as chain_only. For sends to someone who is a counterparty
   *  of the chain rather than a lead of this account — a location
   *  seeker who came in through a co-broker's link. An existing contact
   *  is never downgraded: a real lead who also happens to seek stays a
   *  real lead. */
  createAsChainOnly?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customDbClient?: any
}

export interface DispatcherResult {
  success: boolean
  messageId?: string
  whatsappMessageId?: string
  error?: string
}

export async function sendWhatsAppMessageAndPersist(
  args: SendWhatsAppAndPersistArgs
): Promise<DispatcherResult> {
  const db = args.customDbClient || defaultAdminClient()
  const { accountId, userId, contactId, conversationId, toPhone } = args

  // contacts.user_id and conversations.user_id are still NOT NULL — a
  // legacy holdover from the pre-account tenancy model (see migration
  // 017_account_sharing.sql). System-initiated sends (cron digests,
  // bot replies) have no acting user, so fall back to the account
  // owner rather than `null`, which violates that constraint. Lazy and
  // cached: only queried if a new row actually needs creating.
  let ownerUserId: string | undefined
  const resolveOwnerUserId = async (): Promise<string | null> => {
    if (ownerUserId) return ownerUserId
    const { data } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle()
    ownerUserId = data?.owner_user_id || undefined
    return ownerUserId || null
  }

  try {
    let resolvedContactId = contactId
    let resolvedConversationId = conversationId
    let targetPhone = toPhone

    // 1. Resolve or Create Contact
    if (!resolvedContactId) {
      if (!targetPhone) {
        throw new Error('Either contactId or toPhone must be provided')
      }
      const normalized = targetPhone.replace(/\D/g, '')
      const phoneSuffix = normalized.length >= 8 ? normalized.slice(-8) : normalized

      const { data: contacts, error } = await db
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('is_merged', false)
        .like('phone', `%${phoneSuffix}`)

      if (error) {
        console.error('[meta-api-dispatcher] contact lookup error:', error.message)
      }

      const existing = contacts?.find((c: { phone: string }) => phonesMatch(c.phone, targetPhone!))
      if (existing) {
        resolvedContactId = existing.id
        targetPhone = existing.phone
      } else {
        const { data: newContact, error: createError } = await db
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: userId || (await resolveOwnerUserId()),
            phone: targetPhone,
            name: targetPhone,
            chain_only: args.createAsChainOnly ?? false,
          })
          .select()
          .single()
        if (createError || !newContact) {
          throw new Error(`Failed to find or create contact: ${createError?.message || 'Unknown error'}`)
        }
        resolvedContactId = newContact.id
      }
    } else {
      if (!targetPhone) {
        const { data: contact, error: contactErr } = await db
          .from('contacts')
          .select('phone')
          .eq('id', resolvedContactId)
          .eq('account_id', accountId)
          .maybeSingle()
        if (contactErr || !contact) {
          throw new Error('Contact not found for this account')
        }
        // Email-only contact (migration 253) — nothing to send to.
        if (!contact.phone) {
          throw new Error('This contact has no WhatsApp number')
        }
        targetPhone = contact.phone
      }
    }

    // 1b. Chain-only contacts belong to a re-share attribution chain,
    // not to this account's pipeline. Refused here rather than at each
    // caller for the same reason as the customer window below — every
    // sender funnels through this function, so this is the only place
    // that covers broadcasts, automations, digests and inbox sends
    // alike. Checked before the conversation is resolved so a blocked
    // send leaves no empty thread implying one was attempted.
    // 1c. A lead who closed their enquiry, and a contact an agent
    // archived, are both off the automated-sending list. Refused in the
    // same place and for the same reason as chain-only above: every
    // sender funnels through here, so this is the only guard that
    // covers broadcasts, automations, digests, Radar and shares at
    // once. `allowDeadContact` is the inbox composer's opt-out — an
    // agent answering a lead who called back is a deliberate personal
    // reply, not the automation this blocks.
    if (resolvedContactId && !(args.allowChainOnly && args.allowDeadContact)) {
      const { data: gateRow } = await db
        .from('contacts')
        .select('chain_only, is_dead, is_archived')
        .eq('id', resolvedContactId)
        .eq('account_id', accountId)
        .maybeSingle()
      const gate = gateRow as {
        chain_only?: boolean
        is_dead?: boolean
        is_archived?: boolean
      } | null
      if (!args.allowChainOnly && gate?.chain_only) {
        throw new Error(CHAIN_ONLY_BLOCKED_MESSAGE)
      }
      if (!args.allowDeadContact && (gate?.is_dead || gate?.is_archived)) {
        throw new Error(DEAD_CONTACT_BLOCKED_MESSAGE)
      }
    }

    // 2. Resolve or Create Conversation
    if (!resolvedConversationId) {
      if (!resolvedContactId) {
        throw new Error('Failed to find or create conversation: no contact resolved')
      }
      const { conversation, error: resolveError } = await resolveConversation<{ id: string }>(db, {
        accountId,
        contactId: resolvedContactId,
        userId: userId || (await resolveOwnerUserId()),
        columns: 'id',
      })
      if (!conversation) {
        throw new Error(
          `Failed to find or create conversation: ${resolveError?.message || 'Unknown error'}`,
        )
      }
      resolvedConversationId = conversation.id
    }

    // 2b. Idempotency guard for template sends. A rapid double-submit or
    // two overlapping triggers (e.g. a manual share plus an automation, or
    // the same automation firing twice) must not deliver the identical
    // template to the same conversation twice. If the same rendered
    // template went out in the last few seconds, treat this call as
    // already-sent rather than firing a duplicate. Keyed on the rendered
    // body (`text`) so genuinely different sends (e.g. two properties) are
    // never collapsed, and blind to failed rows — a message Meta refused
    // was never delivered, so a deliberate resend of it is not a duplicate.
    if (args.kind === 'template' && args.templateName) {
      let dupQuery = db
        .from('messages')
        .select('id, message_id')
        .eq('conversation_id', resolvedConversationId)
        .eq('sender_type', args.senderType)
        .eq('content_type', 'template')
        .eq('template_name', args.templateName)
        .neq('status', 'failed')
        .gte('created_at', new Date(Date.now() - DUPLICATE_TEMPLATE_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
      if (args.text) dupQuery = dupQuery.eq('content_text', args.text)
      const { data: recentDuplicate } = await dupQuery.maybeSingle()
      if (recentDuplicate) {
        console.warn(
          `[meta-api-dispatcher] skipped duplicate template "${args.templateName}" to conversation ${resolvedConversationId}`,
        )
        return {
          success: true,
          messageId: recentDuplicate.id,
          whatsappMessageId: recentDuplicate.message_id,
        }
      }
    }

    // 2c. Same idempotency for substantial free-text sends (e.g. the
    // "complete property details" blast). Two overlapping triggers — a
    // double-tap, or approve-from-list plus approve-from-detail — must not
    // deliver the identical long message twice. Length-gated so ordinary
    // short replies are never collapsed.
    if (args.kind === 'text' && args.text && args.text.length >= DUPLICATE_TEXT_MIN_LENGTH) {
      const { data: recentDuplicate } = await db
        .from('messages')
        .select('id, message_id')
        .eq('conversation_id', resolvedConversationId)
        .eq('sender_type', args.senderType)
        .eq('content_type', 'text')
        .eq('content_text', args.text)
        .neq('status', 'failed')
        .gte('created_at', new Date(Date.now() - DUPLICATE_TEMPLATE_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (recentDuplicate) {
        console.warn(
          `[meta-api-dispatcher] skipped duplicate text to conversation ${resolvedConversationId}`,
        )
        return {
          success: true,
          messageId: recentDuplicate.id,
          whatsappMessageId: recentDuplicate.message_id,
        }
      }
    }

    // 3. Load & Decrypt WhatsApp configuration
    const sanitized = sanitizePhoneForMeta(targetPhone)
    if (!isValidE164(sanitized)) {
      throw new Error(`Contact phone invalid format: ${targetPhone}`)
    }

    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()
    if (configErr || !config) {
      throw new Error('WhatsApp not configured for this account')
    }

    let accessToken: string
    let phoneNumberId: string

    // Sandbox mode: use system-wide shared credentials
    if (config.integration_type === 'sandbox') {
      const sandboxSystem = await getSandboxSystemConfig()
      if (!sandboxSystem.enabled || !sandboxSystem.access_token || !sandboxSystem.phone_number_id) {
        throw new Error('Sandbox is not enabled or not configured by the administrator.')
      }
      accessToken = decrypt(sandboxSystem.access_token)
      phoneNumberId = sandboxSystem.phone_number_id
    } else {
      accessToken = decrypt(config.access_token)
      phoneNumberId = config.phone_number_id
    }

    // 3b. Meta's 24-hour customer service window. Free-form text and
    // interactive cards are deliverable only within 24 hours of the
    // contact's last inbound
    // message; outside it Meta accepts the send, returns a wamid, then
    // fails it asynchronously with 131047 — the message lands in the
    // thread as a delivery failure minutes later. Every sender in the
    // codebase funnels through here, so this is the one place that can
    // stop it for automations, flows, reminders and notifications alike,
    // rather than each caller remembering to check. Callers recognise the
    // message via isReengagementError() and fall back to a template.
    // Sandbox swaps in its own system template upstream, so it is left
    // to that path.
    if (
      (args.kind === 'text' || args.kind === 'interactive') &&
      config.integration_type !== 'sandbox'
    ) {
      const { data: lastInbound } = await db
        .from('messages')
        .select('created_at')
        .eq('conversation_id', resolvedConversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!isWithinCustomerWindow(lastInbound?.created_at ?? null)) {
        throw new Error(CUSTOMER_WINDOW_EXPIRED_MESSAGE)
      }
    }

    // 4. Send Message with Variant Retry loop
    const attemptSend = async (phone: string): Promise<string> => {
      switch (args.kind) {
        case 'template':
          if (!args.templateName) throw new Error('templateName is required')
          const resultTpl = await sendTemplateMessage({
            phoneNumberId,
            accessToken,
            to: phone,
            templateName: args.templateName,
            language: args.templateLanguage || 'en_US',
            params: args.templateParams || [],
            messageParams: args.messageParams || undefined,
            template: args.templateRow || undefined,
            contextMessageId: args.contextMessageId || undefined,
          })
          return resultTpl.messageId

        case 'media':
          if (!args.mediaKind || !args.mediaLink) {
            throw new Error('mediaKind and mediaLink are required')
          }
          const resultMed = await sendMediaMessage({
            phoneNumberId,
            accessToken,
            to: phone,
            kind: args.mediaKind,
            link: storagePublicUrl(args.mediaLink),
            caption: args.mediaCaption || undefined,
            filename: args.mediaFilename || undefined,
            // Every other branch forwards this; media dropped it, so a
            // photo sent as a reply arrived in WhatsApp unquoted.
            contextMessageId: args.contextMessageId || undefined,
          })
          return resultMed.messageId

        case 'interactive':
          if (!args.interactiveBody) throw new Error('interactiveBody is required')
          if (args.interactiveType === 'flow') {
            if (!args.flowId || !args.flowToken || !args.flowCta) {
              throw new Error('flowId, flowToken and flowCta are required')
            }
            const resultFlow = await sendFlowMessage({
              phoneNumberId,
              accessToken,
              to: phone,
              bodyText: args.interactiveBody,
              headerText: args.headerText || undefined,
              footerText: args.footerText || undefined,
              flowId: args.flowId,
              flowToken: args.flowToken,
              flowCta: args.flowCta,
              mode: args.flowMode || undefined,
              flowAction: args.flowAction || undefined,
              flowActionPayload: args.flowActionPayload || undefined,
              contextMessageId: args.contextMessageId || undefined,
            })
            return resultFlow.messageId
          } else if (args.interactiveType === 'buttons') {
            if (!args.interactiveButtons) throw new Error('interactiveButtons are required')
            const resultBtn = await sendInteractiveButtons({
              phoneNumberId,
              accessToken,
              to: phone,
              bodyText: args.interactiveBody,
              buttons: args.interactiveButtons,
              headerText: args.headerText || undefined,
              footerText: args.footerText || undefined,
            })
            return resultBtn.messageId
          } else {
            if (!args.interactiveButtonLabel || !args.interactiveSections) {
              throw new Error('interactiveButtonLabel and interactiveSections are required')
            }
            const resultList = await sendInteractiveList({
              phoneNumberId,
              accessToken,
              to: phone,
              bodyText: args.interactiveBody,
              buttonLabel: args.interactiveButtonLabel,
              sections: args.interactiveSections,
              headerText: args.headerText || undefined,
              footerText: args.footerText || undefined,
            })
            return resultList.messageId
          }

        case 'product':
          if (!args.productCatalogId || !args.productRetailerId) {
            throw new Error('productCatalogId and productRetailerId are required')
          }
          const resultProd = await sendProductMessage({
            phoneNumberId,
            accessToken,
            to: phone,
            catalogId: args.productCatalogId,
            productRetailerId: args.productRetailerId,
            bodyText: args.text || undefined,
            footerText: args.footerText || undefined,
            contextMessageId: args.contextMessageId || undefined,
          })
          return resultProd.messageId

        case 'text':
        default:
          if (!args.text) throw new Error('text content is required')
          const resultTxt = await sendTextMessage({
            phoneNumberId,
            accessToken,
            to: phone,
            text: args.text,
            contextMessageId: args.contextMessageId || undefined,
          })
          return resultTxt.messageId
      }
    }

    const variants = phoneVariants(sanitized)
    let workingPhone = sanitized
    let waMessageId = ''
    let lastError: unknown = null

    for (const v of variants) {
      try {
        waMessageId = await attemptSend(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }

    if (lastError) throw lastError

    // 5. Success Post-Processing
    // Update contact phone if working variant is different
    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', resolvedContactId)
    }

    // Determine message attributes
    const content_type =
      args.kind === 'template'
        ? 'template'
        : args.kind === 'media'
        ? args.mediaKind || 'document'
        : args.kind === 'interactive' || args.kind === 'product'
        ? 'interactive'
        : 'text'

    const content_text =
      args.kind === 'text'
        ? args.text
        : args.kind === 'media'
        ? args.mediaCaption || null
        : args.kind === 'interactive'
        ? args.interactiveBody || null
        : args.kind === 'product'
        ? args.text || '[Product Listing]'
        : args.text || null // Fallback to provided text

    const template_name = args.kind === 'template' ? args.templateName : null

    // Insert message record
    const { data: insertedMsg, error: insertErr } = await db
      .from('messages')
      .insert({
        conversation_id: resolvedConversationId,
        sender_type: args.senderType,
        content_type,
        content_text,
        media_url: args.kind === 'media' && args.mediaLink ? storagePublicUrl(args.mediaLink) : null,
        template_name,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: args.replyToMessageId || null,
      })
      .select()
      .single()

    if (insertErr) {
      throw new Error(`Sent to Meta but DB insert failed: ${insertErr.message}`)
    }

    // Update conversation preview text
    const previewText =
      args.kind === 'template'
        ? content_text || `[template:${args.templateName}]`
        : args.kind === 'media'
        ? args.mediaCaption?.trim() || `[${args.mediaKind}]`
        : args.kind === 'interactive'
        ? args.interactiveBody || '[interactive]'
        : args.kind === 'product'
        ? args.text || '[Product Listing]'
        : args.text || ''

    await db
      .from('conversations')
      .update({
        last_message_text: previewText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        awaiting_reply: false,
      })
      .eq('id', resolvedConversationId)

    // A human replied — the chatbot's "Talk to an Agent" handoff flag
    // is resolved, so the thread leaves the pending queue.
    if (args.senderType === 'agent') {
      await db
        .from('conversations')
        .update({ status: 'open' })
        .eq('id', resolvedConversationId)
        .eq('status', 'pending')
    }

    // Flow integration: Pause active Flow runs if agent manually sends a message.
    //
    // ALWAYS through the admin client, never `db`. A send from the
    // inbox passes its RLS-scoped client in, and flow_runs carries only
    // a SELECT policy — so this update was refused, returned zero rows
    // and no error, and the pause silently did nothing for every human
    // reply. A lead negotiating with an agent kept being answered
    // "Sorry, I didn't quite catch that" by a run nobody could stop.
    // .select() makes a future refusal visible instead of silent.
    if (args.senderType === 'agent' && resolvedContactId) {
      // Never let the pause fail the send it follows — the message has
      // already reached the lead by this point.
      try {
        const paused = await standDownActiveFlowRuns(
          defaultAdminClient() as unknown as SupabaseClient,
          accountId,
          resolvedContactId,
        )
        if (paused > 0) {
          console.log(
            `[meta-api-dispatcher] paused ${paused} flow run(s) — agent replied`,
          )
        }
      } catch (flowErr) {
        console.error('[meta-api-dispatcher] flow pause warning:', flowErr)
      }
    }

    // What the agent just told the buyer may be a fact about the
    // listing ("seller's final price is 10.5k per sqft"). Propose it
    // back onto the property so the next buyer's question is answered
    // from the record instead of retyped.
    //
    // Admin client for the same reason the flow pause above uses one: a
    // send from the inbox passes its RLS-scoped client in, and the
    // suggestion is written on behalf of the account, not the caller.
    // Awaited so a serverless invocation is not torn down mid-write;
    // learnFromAgentReply gates on a free regex first, so the ordinary
    // reply costs one predicate and returns.
    if (args.senderType === 'agent' && args.kind === 'text' && args.text && resolvedContactId) {
      try {
        const { learnFromAgentReply } = await import('@/lib/ai/chat-learning')
        await learnFromAgentReply({
          db: defaultAdminClient() as unknown as SupabaseClient,
          accountId,
          contactId: resolvedContactId,
          conversationId: resolvedConversationId ?? null,
          messageId: insertedMsg.id,
          text: args.text,
        })
      } catch (learnErr) {
        console.error('[meta-api-dispatcher] chat learning warning:', learnErr)
      }
    }

    return {
      success: true,
      messageId: insertedMsg.id,
      whatsappMessageId: waMessageId,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown Meta API error'
    console.error('[meta-api-dispatcher] delivery failure:', errorMsg)
    return {
      success: false,
      error: errorMsg,
    }
  }
}
