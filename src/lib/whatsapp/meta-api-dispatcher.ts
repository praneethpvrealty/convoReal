import { createClient } from '@supabase/supabase-js'
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
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils'
import { getSandboxSystemConfig } from '@/lib/system-settings'

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
  contextMessageId?: string | null
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
        if (contactErr || !contact?.phone) {
          throw new Error('Contact not found for this account')
        }
        targetPhone = contact.phone
      }
    }

    // 2. Resolve or Create Conversation
    if (!resolvedConversationId) {
      const { data: existing, error } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', resolvedContactId)
        .maybeSingle()

      if (!error && existing) {
        resolvedConversationId = existing.id
      } else {
        const { data: newConv, error: createError } = await db
          .from('conversations')
          .insert({
            account_id: accountId,
            user_id: userId || (await resolveOwnerUserId()),
            contact_id: resolvedContactId,
          })
          .select()
          .single()
        if (createError || !newConv) {
          throw new Error(`Failed to find or create conversation: ${createError?.message || 'Unknown error'}`)
        }
        resolvedConversationId = newConv.id
      }
    }

    // 2b. Idempotency guard for template sends. A rapid double-submit or
    // two overlapping triggers (e.g. a manual share plus an automation, or
    // the same automation firing twice) must not deliver the identical
    // template to the same conversation twice. If the same rendered
    // template went out in the last few seconds, treat this call as
    // already-sent rather than firing a duplicate. Keyed on the rendered
    // body (`text`) so genuinely different sends (e.g. two properties) are
    // never collapsed.
    if (args.kind === 'template' && args.templateName) {
      let dupQuery = db
        .from('messages')
        .select('id, message_id')
        .eq('conversation_id', resolvedConversationId)
        .eq('sender_type', args.senderType)
        .eq('content_type', 'template')
        .eq('template_name', args.templateName)
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
        reply_to_message_id: args.contextMessageId || null,
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

    // Flow integration: Pause active Flow runs if agent manually sends a message
    if (args.senderType === 'agent') {
      try {
        await db
          .from('flow_runs')
          .update({
            status: 'paused_by_agent',
            ended_at: new Date().toISOString(),
            end_reason: 'agent_replied',
          })
          .eq('account_id', accountId)
          .eq('contact_id', resolvedContactId)
          .eq('status', 'active')
      } catch (flowErr) {
        console.error('[meta-api-dispatcher] flow pause warning:', flowErr)
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
