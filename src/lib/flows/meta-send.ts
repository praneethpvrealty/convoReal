import {
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ------------------------------------------------------------
// Flows-side Meta sender (interactive variants).
//
// Refactored to leverage the unified dispatcher helper.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text: args.text,
    customDbClient: supabaseAdmin(),
  })

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(result.error || 'Failed to send text via Flows WhatsApp dispatcher')
  }

  return { whatsapp_message_id: result.whatsappMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
}

/**
 * Send an image / video / document from the Flows engine.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'media',
    senderType: 'bot',
    mediaKind: args.kind,
    mediaLink: args.link,
    mediaCaption: args.caption,
    mediaFilename: args.filename,
    customDbClient: supabaseAdmin(),
  })

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(result.error || 'Failed to send media via Flows WhatsApp dispatcher')
  }

  return { whatsapp_message_id: result.whatsappMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'interactive',
    senderType: 'bot',
    interactiveType: 'buttons',
    interactiveBody: args.bodyText,
    interactiveButtons: args.buttons,
    headerText: args.headerText,
    footerText: args.footerText,
    customDbClient: supabaseAdmin(),
  })

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(result.error || 'Failed to send interactive buttons via Flows dispatcher')
  }

  return { whatsapp_message_id: result.whatsappMessageId }
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'interactive',
    senderType: 'bot',
    interactiveType: 'list',
    interactiveBody: args.bodyText,
    interactiveButtonLabel: args.buttonLabel,
    interactiveSections: args.sections,
    headerText: args.headerText,
    footerText: args.footerText,
    customDbClient: supabaseAdmin(),
  })

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(result.error || 'Failed to send interactive list via Flows dispatcher')
  }

  return { whatsapp_message_id: result.whatsappMessageId }
}
