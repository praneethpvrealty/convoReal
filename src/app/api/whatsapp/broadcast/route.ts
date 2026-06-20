import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import type { MessageTemplate } from '@/types'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1
    return idx >= 0 && idx < params.length ? params[idx] : match
  })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id.
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
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      broadcast_type = 'template',
      product_catalog_id,
      product_retailer_id,
      content_text,
    } = body

    // Normalize to a list of {phone, params, messageParams} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (broadcast_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template broadcasts' },
        { status: 400 }
      )
    }

    if (broadcast_type === 'product' && !product_retailer_id) {
      return NextResponse.json(
        { error: 'product_retailer_id is required for product broadcasts' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('id, catalog_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    let templateRow: MessageTemplate | null = null
    if (broadcast_type === 'template' && template_name) {
      // Load the template row once so sendTemplateMessage can build
      // header + button components on each iteration. Loading inside
      // the loop would N+1 against Supabase for every recipient.
      let query = supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', template_name)

      if (template_language) {
        query = query.eq('language', template_language)
      } else {
        query = query.eq('language', 'en_US')
      }

      const { data: rawTemplates } = await query.limit(1)
      let rawTemplateRow = rawTemplates && rawTemplates.length > 0 ? rawTemplates[0] : null

      // Fallback: If not found, try to find the template in any language
      if (!rawTemplateRow) {
        const { data: fallbackTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', template_name)
          .limit(1)
        if (fallbackTemplates && fallbackTemplates.length > 0) {
          rawTemplateRow = fallbackTemplates[0]
        }
      }

      if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
          },
          { status: 500 },
        )
      }
      templateRow = rawTemplateRow ?? null
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      let result
      if (broadcast_type === 'template' && template_name) {
        const bodyParams = recipient.messageParams?.body || recipient.params || []
        const resolvedText = templateRow?.body_text
          ? resolveTemplateBodyText(templateRow.body_text, bodyParams)
          : `[Template: ${template_name}]`

        result = await sendWhatsAppMessageAndPersist({
          accountId,
          userId: user.id,
          toPhone: recipient.phone,
          kind: 'template',
          senderType: 'agent', // Broadcasts logged as agent replies
          templateName: template_name,
          templateLanguage: templateRow?.language || template_language || 'en_US',
          templateParams: recipient.params || [],
          messageParams: recipient.messageParams || undefined,
          templateRow: templateRow ?? undefined,
          text: resolvedText,
          customDbClient: supabase,
        })
      } else {
        const defaultText = content_text || `*New Listing Available*\n\n${product_retailer_id}`
        result = await sendWhatsAppMessageAndPersist({
          accountId,
          userId: user.id,
          toPhone: recipient.phone,
          kind: 'product',
          senderType: 'agent',
          productCatalogId: product_catalog_id || config.catalog_id,
          productRetailerId: product_retailer_id,
          text: defaultText,
          customDbClient: supabase,
        })
      }

      if (result.success && result.whatsappMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: result.whatsappMessageId,
        })
        sentCount++
      } else {
        console.error(`Failed to send broadcast to ${recipient.phone}:`, result.error)
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: result.error || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
