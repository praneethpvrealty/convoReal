import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { MessageTemplate } from '@/types'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { parseMetaErrorInfo } from '@/lib/whatsapp/meta-api'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id. Every downstream lookup
    // (conversation, whatsapp_config, message_templates) is account-
    // scoped post-multi-user, so the previous `user_id` filters
    // returned nothing for teammates who didn't author the row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      product_catalog_id,
      product_retailer_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    if (message_type === 'product' && !product_retailer_id) {
      return NextResponse.json(
        { error: 'product_retailer_id is required for product messages' },
        { status: 400 }
      )
    }

    // Fetch conversation and contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .single()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Self-heal legacy CBC-encrypted tokens. Fire-and-forget: we
    // return from the send without waiting, so a failed upgrade just
    // means the next send tries again. The upgrade is idempotent —
    // concurrent sends both produce valid GCM ciphertexts of the same
    // plaintext, last write wins.
    if (isLegacyFormat(config.access_token)) {
      void supabase
        .from('whatsapp_config')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(({ error }) => {
          if (error) {
            console.warn(
              '[whatsapp/send] access_token GCM upgrade failed:',
              error.message,
            )
          }
        })
    }

    // Resolve the reply target (if any) to its Meta message_id, which is
    // what `context.message_id` on the outgoing Meta payload needs. The
    // parent must belong to this same conversation — otherwise a caller
    // could quote messages they can't see by guessing UUIDs.
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const { data: parent, error: parentError } = await supabase
        .from('messages')
        .select('message_id, conversation_id')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', conversation_id)
        .maybeSingle()

      if (parentError || !parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.message_id) {
        // Parent never reached Meta (still in 'sending' or 'failed') — we
        // can't quote it on WhatsApp. Send without context rather than
        // dropping the message entirely.
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.message_id
      }
    }

    // Send via Meta API — retry with phone-number variants if Meta rejects
    // with "recipient not in allowed list" (common in sandbox / when a
    // number was registered with/without a trunk 0). If an alternate
    // format succeeds, we persist it back to the contact row so the
    // next send goes through on the first attempt.

    // For template sends, load the row so sendTemplateMessage can
    // build header + button components from the template definition.
    // Match on (user_id, name, language) — same triple the unique
    // index enforces — so multi-language templates work correctly.
    // Missing template falls through with `templateRow = null` and
    // the legacy body-only path runs.
    // Load the template row so sendTemplateMessage can build header
    // + button components from the definition. isMessageTemplate
    // guards against a malformed row (e.g. from a partial sync)
    // crashing the send-builder later in the stack.
    let templateRow: MessageTemplate | null = null
    if (message_type === 'template' && template_name) {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', template_name)
        .eq('language', template_language || 'en_US')
        .maybeSingle()

      let templateData = data
      if (!templateData) {
        const { data: fallbackTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', template_name)
          .limit(1)
        if (fallbackTemplates && fallbackTemplates.length > 0) {
          templateData = fallbackTemplates[0]
        }
      }

      if (templateData && !isMessageTemplate(templateData)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
          },
          { status: 500 },
        )
      }
      templateRow = (templateData as MessageTemplate) ?? null
    }

    // ── Sandbox 24h Window Check ────────────────────────────────
    let finalMessageType = message_type
    let finalTemplateName = template_name
    let finalTemplateRow = templateRow
    let finalText = content_text

    if (config.integration_type === 'sandbox' && message_type === 'text') {
      // Check if last customer message was within 24 hours
      const { data: lastCustomerMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const windowHours = 24
      const isWithinWindow = lastCustomerMsg &&
        (new Date().getTime() - new Date(lastCustomerMsg.created_at).getTime()) < windowHours * 60 * 60 * 1000

      if (!isWithinWindow) {
        // Outside 24h window — must use template
        const { data: systemTemplate } = await supabase
          .from('sandbox_system_templates')
          .select('*')
          .eq('name', 'sandbox_general_reply')
          .maybeSingle()

        if (systemTemplate) {
          finalMessageType = 'template'
          finalTemplateName = systemTemplate.name
          finalTemplateRow = {
            ...systemTemplate,
            account_id: accountId,
            meta_template_id: `sandbox-${systemTemplate.name}`,
            status: 'APPROVED',
            components: [
              {
                type: 'HEADER',
                format: 'TEXT',
                text: systemTemplate.header_text || '',
              },
              {
                type: 'BODY',
                text: systemTemplate.body,
                example: { body_text: [[content_text || 'there']] },
              },
              {
                type: 'FOOTER',
                text: systemTemplate.footer || '',
              },
              {
                type: 'BUTTONS',
                buttons: (systemTemplate.buttons as Array<{ type: string; text: string }>)?.map((b) => ({
                  type: b.type,
                  text: b.text,
                })) || [],
              },
            ],
            language: systemTemplate.language,
            name: systemTemplate.name,
          }
          finalTemplateRow = finalTemplateRow as unknown as MessageTemplate
          // Pass the text as template param {{1}}
          finalText = content_text || ''
        }
      }
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: user.id,
      contactId: contact.id,
      conversationId: conversation.id,
      kind: finalMessageType === 'template' ? 'template' : finalMessageType === 'product' ? 'product' : 'text',
      senderType: 'agent',
      text: finalText,
      templateName: finalTemplateName,
      templateLanguage: template_language,
      templateParams: finalMessageType === 'template' ? [finalText || 'there'] : template_params,
      messageParams: template_message_params ?? undefined,
      templateRow: finalTemplateRow ?? undefined,
      productCatalogId: product_catalog_id || config.catalog_id,
      productRetailerId: product_retailer_id,
      contextMessageId,
      customDbClient: supabase,
    })

    if (!result.success) {
      const errorInfo = parseMetaErrorInfo(result.error);
      return NextResponse.json(
        { 
          error: result.error || 'Failed to send message via WhatsApp dispatcher',
          errorInfo: {
            code: errorInfo.code,
            title: errorInfo.title,
            userMessage: errorInfo.userMessage,
            suggestedActions: errorInfo.suggestedActions,
            isRetryable: errorInfo.isRetryable
          }
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    const errorInfo = parseMetaErrorInfo(error);
    return NextResponse.json(
      { 
        error: 'Failed to send message',
        errorInfo: {
          code: errorInfo.code,
          title: errorInfo.title,
          userMessage: errorInfo.userMessage,
          suggestedActions: errorInfo.suggestedActions,
          isRetryable: errorInfo.isRetryable
        }
      },
      { status: 500 }
    )
  }
}
