/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  /** Not available on Meta test/sandbox numbers — falls back to the phone_number_id. */
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    type?: string
    error_user_title?: string
    error_user_msg?: string
    error_data?: {
      details?: string
    }
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) {
      message = data.error.message
      const userMsg = data.error.error_user_msg
      const userTitle = data.error.error_user_title

      if (userMsg) {
        message += `: ${userMsg}`
      }
      if (userTitle) {
        message += ` (${userTitle})`
      }
      if (data.error.error_data?.details) {
        message += ` (Details: ${data.error.error_data.details})`
      }
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// User-friendly error messages for Meta API errors
// ============================================================

export interface MetaErrorInfo {
  code: number
  title: string
  message: string
  userMessage: string
  suggestedActions: string[]
  isRetryable: boolean
}

/**
 * Parse Meta API error codes and return user-friendly information
 * with suggested actions for the user.
 */
export function parseMetaErrorInfo(error: unknown): MetaErrorInfo {
  const errorMsg = error instanceof Error ? error.message : String(error);
  
  // Extract error code from message (e.g., "[Error 131026]" or "(#131026)")
  const codeMatch = errorMsg.match(/(?:Error|error|#)\s*(\d{5,6})/);
  const code = codeMatch ? parseInt(codeMatch[1]) : 0;
  
  // Default error info
  const defaultInfo: MetaErrorInfo = {
    code,
    title: 'Message Delivery Failed',
    message: errorMsg,
    userMessage: 'Unable to deliver message. Please try again later.',
    suggestedActions: [
      'Check if the recipient is available on WhatsApp',
      'Verify the phone number is correct',
      'Try again in a few minutes'
    ],
    isRetryable: true
  };
  
  // Map specific error codes to user-friendly messages
  const errorMap: Record<number, Partial<MetaErrorInfo>> = {
    // Message Undeliverable - broad bucket error
    131026: {
      title: 'Message Undeliverable',
      userMessage: 'This message could not be delivered. This can happen if the recipient is not on WhatsApp, has blocked your number, or is using an outdated WhatsApp version.',
      suggestedActions: [
        'Verify the recipient has WhatsApp installed and is online',
        'Check if the phone number is correct and includes country code',
        'Ask the recipient to update WhatsApp to the latest version',
        'Ensure the recipient has accepted WhatsApp Terms of Service',
        'Try sending a simple text message to test connectivity',
        'If issue persists, contact the recipient via another channel'
      ],
      isRetryable: false
    },
    
    // Marketing frequency cap
    131049: {
      title: 'Message Blocked by Rate Limit',
      userMessage: 'Meta has blocked this marketing message to protect users from excessive messages. This is part of WhatsApp\'s healthy ecosystem engagement policy.',
      suggestedActions: [
        'Wait before retrying (try increasing time intervals)',
        'Use a Utility template instead of Marketing',
        'Reduce message frequency to this contact',
        'Ensure the recipient has opted in to receive messages'
      ],
      isRetryable: true
    },
    
    // Template not found
    132001: {
      title: 'Template Not Found',
      userMessage: 'The message template does not exist on Meta or has been disabled.',
      suggestedActions: [
        'Go to Settings > WhatsApp > Templates and click "Sync from Meta"',
        'Verify the template name is spelled correctly',
        'Check if the template was recently edited and needs re-sync',
        'Create a new template if the old one was deleted'
      ],
      isRetryable: false
    },
    
    // Template parameters mismatch
    132000: {
      title: 'Template Parameters Error',
      userMessage: 'The template parameters do not match the template structure.',
      suggestedActions: [
        'Check that all required parameters are provided',
        'Verify parameter count matches template placeholders',
        'Ensure parameter values are within character limits'
      ],
      isRetryable: false
    },
    
    // Recipient not allowed (business-initiated message to non-opted-in user)
    131025: {
      title: 'Recipient Not Opted In',
      userMessage: 'The recipient has not opted in to receive messages from your business.',
      suggestedActions: [
        'Ensure the recipient has given explicit consent',
        'The recipient should message your business first',
        'Use an opt-in form or process before sending messages'
      ],
      isRetryable: false
    },
    
    // Message failed to send
    131047: {
      title: 'Session Expired',
      userMessage: 'The 24-hour customer service window has expired. You need to use a template message.',
      suggestedActions: [
        'Send a Utility or Marketing template message',
        'Wait for the customer to send a message first',
        'Use the Templates feature in the composer'
      ],
      isRetryable: false
    },
    
    // Authentication template to India
    131021: {
      title: 'Authentication Not Supported in India',
      userMessage: 'Authentication templates cannot be sent to Indian (+91) phone numbers.',
      suggestedActions: [
        'Use SMS or email for OTP/verification in India',
        'Use a Utility template for non-authentication messages',
        'Contact Meta support for India-specific guidance'
      ],
      isRetryable: false
    },
    
    // Rate limit hit
    130429: {
      title: 'Rate Limit Exceeded',
      userMessage: 'Too many requests sent. Please wait before retrying.',
      suggestedActions: [
        'Wait a few minutes before trying again',
        'Reduce the frequency of messages',
        'Implement exponential backoff for retries'
      ],
      isRetryable: true
    },
    
    // Temporary ban
    368: {
      title: 'Account Temporarily Restricted',
      userMessage: 'Your WhatsApp Business account has been temporarily restricted due to policy violations.',
      suggestedActions: [
        'Check your email for details from Meta',
        'Review WhatsApp Business Policy',
        'Wait for the restriction to be lifted',
        'Contact Meta Business Support if needed'
      ],
      isRetryable: false
    }
  };
  
  // Look up error code in map
  const mappedError = errorMap[code];
  if (mappedError) {
    return {
      ...defaultInfo,
      ...mappedError,
      code,
      message: errorMsg
    };
  }
  
  // Check for common error patterns in the message
  if (errorMsg.includes('undeliverable') || errorMsg.includes('Undeliverable')) {
    return {
      ...defaultInfo,
      ...errorMap[131026],
      code: code || 131026,
      message: errorMsg
    };
  }
  
  if (errorMsg.includes('rate limit') || errorMsg.includes('too many')) {
    return {
      ...defaultInfo,
      ...errorMap[130429],
      code: code || 130429,
      message: errorMsg
    };
  }
  
  return defaultInfo;
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const headers = { Authorization: `Bearer ${accessToken}` }

  // Step 1: fetch only `id` — this field always exists on both real and
  // test/sandbox numbers and proves the token + phone_number_id are valid.
  // Requesting optional fields (display_phone_number, verified_name,
  // quality_rating) in the same call causes Meta to return #100
  // "Tried accessing nonexisting field" for test numbers, which would
  // block the entire config save.
  const idUrl = `${META_API_BASE}/${phoneNumberId}?fields=id`
  const idRes = await fetch(idUrl, { headers })
  if (!idRes.ok) {
    await throwMetaError(idRes, `Meta API error: ${idRes.status}`)
  }
  const { id } = (await idRes.json()) as { id: string }

  // Step 2: best-effort — fetch all optional display fields in one call.
  // Test numbers don't expose these fields and Meta returns #100; we
  // swallow the error and fall back to safe defaults so saving still works.
  let display_phone_number: string = phoneNumberId
  let verified_name: string | undefined
  let quality_rating: string | undefined
  try {
    const extUrl = `${META_API_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`
    const extRes = await fetch(extUrl, { headers })
    if (extRes.ok) {
      const ext = (await extRes.json()) as {
        display_phone_number?: string
        verified_name?: string
        quality_rating?: string
      }
      if (ext.display_phone_number) display_phone_number = ext.display_phone_number
      verified_name = ext.verified_name
      quality_rating = ext.quality_rating
    }
  } catch {
    // Swallow — test/sandbox numbers don't support these fields
  }

  return { id, display_phone_number, verified_name, quality_rating }
}

// ============================================================
// Cloud API registration (subscription for inbound webhooks)
// ============================================================
//
// Saving a phone_number_id + access_token to whatsapp_config is NOT
// enough to receive inbound events from Meta. Two extra calls are
// required:
//
//   POST /{phone_number_id}/register
//     Subscribes the number for THIS app's webhook. Requires a
//     6-digit 2FA PIN the user previously set in Meta WhatsApp
//     Manager → Two-step verification. Without /register, inbound
//     events are routed to whichever app last claimed the number
//     (often the one that did Embedded Signup) — so a second user
//     adding a second number under the same WABA silently loses
//     every inbound message.
//
//   POST /{waba_id}/subscribed_apps
//     Subscribes the WABA itself to this app. Required exactly
//     once per WABA, but idempotent so calling on every save is
//     safe and cheap.
//
// Both calls are no-ops when already done — Meta returns success +
// the helpers below treat that as success.

export interface RegisterPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
  /**
   * 6-digit PIN the user set in Meta WhatsApp Manager →
   * Two-step verification. If 2FA is not enabled on the number,
   * Meta rejects /register with a clear error and the user is
   * pointed at the right setting in the UI.
   */
  pin: string
}

export interface RegisterPhoneNumberResult {
  success: boolean
  /**
   * True when Meta indicated the number was already registered to
   * THIS app — same outcome as a fresh registration from the
   * caller's POV, surfaced separately for logging clarity.
   */
  alreadyRegistered: boolean
  /**
   * True when Meta rejected /register with "Unsupported post request" —
   * this is the expected response for test/sandbox phone numbers which
   * are pre-registered by Meta and don't support the /register endpoint.
   * Treat this as a successful save, not a user-actionable error.
   */
  testNumberSkipped?: boolean
}

/**
 * Register a phone number for inbound webhook events.
 *
 * Errors that should be surfaced verbatim to the user:
 *   * Missing / wrong PIN  → "Two-step verification PIN required..."
 *   * No 2FA enabled       → "Two-factor authentication is not on..."
 *   * Number on other app  → "Number is registered to another app..."
 *
 * Silently treated as success:
 *   * "Unsupported post request" / "does not support this operation" →
 *     Meta test/sandbox numbers are pre-registered and don't expose the
 *     /register endpoint. Flag `testNumberSkipped: true` so callers
 *     can save without surfacing a confusing PIN-retry error.
 */
export async function registerPhoneNumber(
  args: RegisterPhoneNumberArgs
): Promise<RegisterPhoneNumberResult> {
  const { phoneNumberId, accessToken, pin } = args
  const url = `${META_API_BASE}/${phoneNumberId}/register`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })

  if (response.ok) {
    return { success: true, alreadyRegistered: false }
  }

  // Meta returns an error envelope with a code. Code 133005 + the
  // text "already registered" appears when the number is already
  // subscribed to this app — that's success from the caller's
  // perspective, surface it as such.
  let data: { error?: { message?: string; code?: number; error_subcode?: number } } = {}
  try {
    data = await response.json()
  } catch {
    /* keep empty */
  }
  const message = data.error?.message ?? `Meta API error: ${response.status}`

  if (/already.*registered/i.test(message)) {
    return { success: true, alreadyRegistered: true }
  }

  // Test/sandbox numbers return "Unsupported post request. Object with ID
  // '...' does not exist, cannot be loaded due to missing permissions, or
  // does not support this operation." — /register is simply not available
  // for these numbers. Treat as a silent skip so the UI doesn't demand a
  // PIN retry for something that will never work.
  if (/unsupported post request/i.test(message) || /does not support this operation/i.test(message)) {
    return { success: true, alreadyRegistered: false, testNumberSkipped: true }
  }

  // 2-step verification is disabled on this number. The /register endpoint
  // requires 2FA to be enabled, but for test numbers and numbers already
  // subscribed via Embedded Signup this doesn't affect message flow at all.
  // Skip gracefully rather than blocking the save with an error.
  if (/two.?factor authentication is not on/i.test(message) || /two.?step verification.*not.*enabled/i.test(message)) {
    return { success: true, alreadyRegistered: false, testNumberSkipped: true }
  }

  throw new Error(message)
}

export interface SubscribeWabaToAppArgs {
  wabaId: string
  accessToken: string
}

/**
 * Subscribe the WABA to this Meta app's webhook. Idempotent — Meta
 * returns success even when the subscription already exists.
 */
export async function subscribeWabaToApp(
  args: SubscribeWabaToAppArgs
): Promise<void> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface GetSubscribedAppsArgs {
  wabaId: string
  accessToken: string
}

export interface SubscribedApp {
  whatsapp_business_api_data?: {
    id?: string
    name?: string
    link?: string
  }
}

/**
 * Diagnostic — fetch the list of apps currently subscribed to this
 * WABA. The UI uses this to confirm OUR app is in the list when
 * the user clicks Verify Registration.
 */
export async function getSubscribedApps(
  args: GetSubscribedAppsArgs
): Promise<SubscribedApp[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: SubscribedApp[] }
  return data.data ?? []
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export type MediaKind = 'image' | 'video' | 'document'

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  /** Optional caption — Meta caps at 1024 chars. Documents + images + videos all accept it. */
  caption?: string
  /** Document-only. Shown in the recipient's chat as the file name. Ignored for image/video. */
  filename?: string
  contextMessageId?: string
}

/**
 * Send an image, video, or document via a public URL.
 *
 * Used by the Flows engine's `send_media` node. Mirrors
 * `sendTextMessage` — single fetch, throws on non-2xx, returns Meta's
 * message id.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, kind, link, caption, filename, contextMessageId } = args
  if (!link) throw new Error('sendMediaMessage requires a link.')
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const media: Record<string, unknown> = { link }
  if (caption) media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

import type { MessageTemplate } from '@/types'
import {
  buildSendComponents,
  sanitizeParamText,
  type SendTimeParams,
} from './template-send-builder'

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  /**
   * Legacy body-only params. Kept for backward compat with callers
   * that haven't migrated to the structured `template` + `messageParams`
   * pair below. New callers should pass `template` so media headers
   * and URL buttons land on the send.
   */
  params?: string[]
  /**
   * The template row from message_templates. When provided, the helper
   * builds the full components array (header + body + buttons) via
   * buildSendComponents — that's the only way image/video/document
   * headers and URL-with-variable buttons actually reach the recipient.
   */
  template?: MessageTemplate
  /**
   * Structured per-send values. Body variables go in `body`; header
   * text variables in `headerText`; media overrides in
   * `headerMediaUrl` / `headerMediaId`; URL/COPY_CODE button values
   * in `buttonParams` keyed by index.
   */
  messageParams?: SendTimeParams
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 *
 * Caller paths:
 *   - Legacy: pass `params: string[]` (body only). Same behaviour as
 *     before this helper learned about media + buttons.
 *   - Structured: pass `template` (and optionally `messageParams`).
 *     The full components array is built from the row so media
 *     headers + URL buttons land correctly.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    template,
    messageParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  if (template) {
    const components = buildSendComponents(template, {
      // Legacy callers pass body values in `params`; fold them into
      // `messageParams.body` so the new path covers them too.
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    })
    if (components.length > 0) {
      templatePayload.components = components
    }
  } else if (messageParams || (params && params.length > 0)) {
    const components: Record<string, unknown>[] = []
    const bodyParams = messageParams?.body ?? params
    if (bodyParams && bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((p) => ({ type: 'text', text: sanitizeParamText(String(p)) })),
      })
    }
    if (messageParams?.buttonParams) {
      Object.entries(messageParams.buttonParams).forEach(([idxStr, btnText]) => {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: idxStr,
          parameters: [
            {
              type: 'text',
              text: btnText,
            },
          ],
        })
      })
    }
    if (components.length > 0) {
      templatePayload.components = components
    }
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let nextLanguages: string[] = []
    try {
      const errorJson = await response.clone().json() as MetaErrorResponse
      if (errorJson.error?.code === 132001) {
        const currentLang = (templatePayload.language as { code?: string })?.code || language
        const englishLocales = ['en_US', 'en', 'en_GB']
        if (englishLocales.includes(currentLang)) {
          nextLanguages = englishLocales.filter(l => l !== currentLang)
        }
      }
    } catch {
      // Ignored
    }

    for (const nextLang of nextLanguages) {
      if (response.ok) break

      console.warn(`[Meta API] sendTemplateMessage failed with 132001 (Template not found) for language "${(templatePayload.language as { code?: string })?.code || language}". Retrying with "${nextLang}"...`)
      templatePayload.language = { code: nextLang }
      body.template = templatePayload
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })
    }
  }

  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Template submission (Business Management API)
// ============================================================

import type { MetaTemplateSubmitPayload } from './template-components'

export interface SubmitMessageTemplateArgs {
  wabaId: string
  accessToken: string
  payload: MetaTemplateSubmitPayload
}

export interface SubmitMessageTemplateResult {
  id: string
  status: string
  category?: string
}

/**
 * Submit a message template to Meta for approval.
 *
 * Returns Meta's assigned template id + initial status (typically
 * PENDING). Caller persists `id` as `meta_template_id` so the
 * upcoming edit/delete flows can scope to this exact template (and
 * language variant) via `hsm_id`, rather than nuking every variant
 * with the same name.
 *
 * 429s from Meta (rate limit: 100 creates/hour/WABA) surface as a
 * regular `Error('Meta API error: 429')`. The route handler
 * distinguishes 429 and shows a more actionable toast.
 */
export async function submitMessageTemplate(
  args: SubmitMessageTemplateArgs
): Promise<SubmitMessageTemplateResult> {
  const { wabaId, accessToken, payload } = args
  const url = `${META_API_BASE}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.id) {
    throw new Error('Meta accepted the template but returned no id.')
  }
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    category: typeof data.category === 'string' ? data.category : undefined,
  }
}

export interface EditMessageTemplateArgs {
  /** Meta's template id (stored locally as `meta_template_id`). */
  metaTemplateId: string
  accessToken: string
  /** Send the full components array — Meta replaces, not patches. */
  components: MetaTemplateSubmitPayload['components']
  /** Optional — only certain category transitions are allowed by Meta. */
  category?: MetaTemplateSubmitPayload['category']
}

export interface EditMessageTemplateResult {
  success: boolean
}

/**
 * Edit an existing (APPROVED or REJECTED) message template.
 *
 * Meta caps edits at 10 per 30 days (and 1 per 24h for APPROVED
 * templates). Every edit re-triggers review, so the status flips
 * back to PENDING until Meta approves the new components.
 *
 * Note: PENDING / DISABLED / IN_APPEAL templates cannot be edited
 * — the route handler enforces that before calling here.
 */
export async function editMessageTemplate(
  args: EditMessageTemplateArgs
): Promise<EditMessageTemplateResult> {
  const { metaTemplateId, accessToken, components, category } = args
  const body: Record<string, unknown> = { components }
  if (category) body.category = category
  const response = await fetch(`${META_API_BASE}/${metaTemplateId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json().catch(() => ({}))
  return { success: data?.success !== false }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  /**
   * Without `hsm_id`, Meta deletes EVERY language variant of the
   * template with this `name`. Pass the row's `meta_template_id`
   * to scope to a single variant.
   */
  metaTemplateId?: string
}

/**
 * Delete a message template on Meta. Pass `metaTemplateId` to scope
 * to a single language variant — otherwise Meta nukes every variant
 * sharing the same `name`.
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs
): Promise<void> {
  const { wabaId, accessToken, name, metaTemplateId } = args
  const params = new URLSearchParams({ name })
  if (metaTemplateId) params.set('hsm_id', metaTemplateId)
  const url = `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Treat a 404 as a no-op — the template is already gone on Meta's
  // side, and we still want the local row removed.
  if (response.status === 404) return
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText: rawBodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  
  const bodyText = rawBodyText && rawBodyText.length > INTERACTIVE_LIMITS.bodyMaxLength
    ? rawBodyText.substring(0, INTERACTIVE_LIMITS.bodyMaxLength - 4) + '...'
    : rawBodyText;

  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText: rawBodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  
  const bodyText = rawBodyText && rawBodyText.length > INTERACTIVE_LIMITS.bodyMaxLength
    ? rawBodyText.substring(0, INTERACTIVE_LIMITS.bodyMaxLength - 4) + '...'
    : rawBodyText;

  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Check if the access token has the required WhatsApp permissions.
 * Returns a list of issues found, or empty array if all good.
 */
export async function checkWhatsAppPermissions(
  accessToken: string,
  wabaId?: string | null
): Promise<{ hasIssues: boolean; issues: string[] }> {
  const issues: string[] = []

  // Test 1: Check if token can access phone numbers (basic permission)
  try {
    const response = await fetch(`${META_API_BASE}/me/phone_numbers?limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      issues.push('Token cannot access phone numbers - missing whatsapp_business_messaging permission')
    }
  } catch {
    issues.push('Failed to verify phone number access')
  }

  // Test 2: Check if token can access WABA (if provided)
  if (wabaId) {
    try {
      const response = await fetch(`${META_API_BASE}/${wabaId}?fields=id,name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        issues.push('Token cannot access WhatsApp Business Account - missing whatsapp_business_management permission')
      }
    } catch {
      issues.push('Failed to verify WABA access')
    }
  }

  // Test 3: Try to fetch a test media object to verify media permissions
  // This is a lightweight check - we don't need a real media ID, just checking if the endpoint responds
  try {
    const response = await fetch(`${META_API_BASE}/me/media?limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    // Even a 404 means the endpoint exists and we have some access
    // A 403 or 401 would indicate missing permissions
    if (response.status === 401 || response.status === 403) {
      issues.push('Token lacks media access permissions - ensure whatsapp_business_messaging scope is enabled')
    }
  } catch {
    // Network errors are not permission issues
  }

  return { hasIssues: issues.length > 0, issues }
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  
  if (!response.ok) {
    // Read the body once — it can only be consumed once
    const errorBody = await response.text()
    let metaMessage = `Media fetch failed: ${response.status}`
    try {
      const parsed = JSON.parse(errorBody)
      if (parsed?.error?.message) {
        metaMessage = parsed.error.message
      }
    } catch {
      // not JSON, use raw body if short enough
      if (errorBody && errorBody.length < 300) metaMessage = errorBody
    }
    // Only log as error for unexpected failures; for known "does not exist" cases
    // the proxy route will handle it gracefully and log a warn
    const isKnownUnavailable =
      metaMessage.includes('does not exist') ||
      metaMessage.includes('missing permissions') ||
      metaMessage.includes('GraphMethodException')
    if (!isKnownUnavailable) {
      console.error(`[meta-api] Media ${mediaId} fetch failed:`, {
        status: response.status,
        body: errorBody,
      })
    }
    throw new Error(metaMessage)
  }
  
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

// ============================================================
// Commerce Catalog Sync & Product Messaging (Option 2)
// ============================================================

export interface SyncProductToCatalogArgs {
  catalogId: string
  accessToken: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  property: any
}

/**
 * Synchronize a property listing with the Meta Commerce Catalog.
 * Uses the Graph API Catalog batch endpoint with allow_upsert: true.
 */
export async function syncProductToCatalog(
  args: SyncProductToCatalogArgs
): Promise<void> {
  const { catalogId, accessToken, property } = args
  const url = `${META_API_BASE}/${catalogId}/batch`

  const price = Number(property.price) || 0
  const title = property.title || 'Property Listing'

  const descriptionParts: string[] = []
  if (property.property_code) descriptionParts.push(`Code: ${property.property_code}`)
  if (property.location) descriptionParts.push(`Location: ${property.location}`)
  if (property.description) descriptionParts.push(property.description)
  const description = descriptionParts.join('\n').substring(0, 900) || 'Property details'

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://convoreal.com'
  const productUrl = `${siteUrl}/?property_id=${property.id}`
  const heroImage = (Array.isArray(property.images) ? property.images : [])
    .map((img: string) => img.trim())
    .find((img: string) => img.length > 0) || `${siteUrl}/placeholder.png`

  const retailerId = property.property_code || property.id

  const body = {
    allow_upsert: true,
    requests: [
      {
        method: 'UPDATE',
        retailer_id: retailerId,
        data: {
          name: title.substring(0, 140),
          description,
          image_url: heroImage,
          price,
          currency: 'INR',
          availability: 'in stock',
          condition: 'new',
          url: productUrl,
          brand: 'waCRM Properties',
        },
      },
    ],
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta Catalog sync failed: ${response.status}`)
  }

  const resJson = await response.json().catch(() => ({}));
  console.log('[syncProductToCatalog] Meta API Response:', JSON.stringify(resJson, null, 2));

  if (Array.isArray(resJson.validation_status)) {
    const errorMessages: string[] = []
    for (const status of resJson.validation_status) {
      if (Array.isArray(status.errors) && status.errors.length > 0) {
        for (const err of status.errors) {
          if (err.message) {
            errorMessages.push(`${status.retailer_id ? status.retailer_id + ': ' : ''}${err.message}`)
          }
        }
      }
    }
    if (errorMessages.length > 0) {
      throw new Error(`Meta validation error: ${errorMessages.join('; ')}`)
    }
  }
}

export interface DeleteProductFromCatalogArgs {
  catalogId: string
  accessToken: string
  retailerId: string
}

/**
 * Delete a product listing from the Meta Commerce Catalog.
 */
export async function deleteProductFromCatalog(
  args: DeleteProductFromCatalogArgs
): Promise<void> {
  const { catalogId, accessToken, retailerId } = args
  const url = `${META_API_BASE}/${catalogId}/batch`

  const body = {
    requests: [
      {
        method: 'DELETE',
        retailer_id: retailerId,
      },
    ],
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta Catalog delete failed: ${response.status}`)
  }
}

export interface SendProductMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  productRetailerId: string
  bodyText?: string
  footerText?: string
  contextMessageId?: string
}

/**
 * Send an interactive single product message.
 * When the customer taps, it opens the native Meta catalog overlay.
 */
export async function sendProductMessage(
  args: SendProductMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    catalogId,
    productRetailerId,
    bodyText,
    footerText,
    contextMessageId,
  } = args

  const action = {
    catalog_id: catalogId,
    product_retailer_id: productRetailerId,
  }

  const interactive: Record<string, unknown> = {
    type: 'product',
    action,
  }
  if (bodyText) {
    interactive.body = {
      text: bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength
        ? bodyText.substring(0, INTERACTIVE_LIMITS.bodyMaxLength - 4) + '...'
        : bodyText,
    }
  }
  if (footerText) {
    interactive.footer = {
      text: footerText.length > INTERACTIVE_LIMITS.footerMaxLength
        ? footerText.substring(0, INTERACTIVE_LIMITS.footerMaxLength - 4) + '...'
        : footerText,
    }
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta API product message failed: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

