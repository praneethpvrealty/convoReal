import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, sendTextMessage } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch, normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { checkIsAccountOwner, processOwnerChatbotMessage } from '@/lib/ai/chatbot-engine'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'

// Lazy-initialized to avoid build-time crash when env vars are missing
let _adminClient: SupabaseClient | null = null
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export interface WhatsAppMessage {
  id: string
  from: string
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
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string }
    phones?: Array<{ phone: string; type?: string; wa_id?: string }>
    emails?: Array<{ email: string; type?: string }>
    vcard: string
  }>
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  context?: { id: string }
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

      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (configError) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          configError
        )
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r: { account_id: string; user_id: string }) => `${r.account_id} (admin ${r.user_id})`)
        )
        continue
      }

      const config = configRows[0]
      const decryptedAccessToken = decrypt(config.access_token)

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
        updatePayload.content_text = `${originalText}\n\n❌ Delivery Failed:\n${errorDetails}`.trim()
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
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

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

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  if (contentText) {
    try {
      const { data: properties } = await supabaseAdmin()
        .from('properties')
        .select('id, title, property_code')
        .eq('account_id', accountId)
        .eq('is_published', true);

      if (properties) {
        const matchedProperty = properties.find((p: { id: string; title: string; property_code?: string }) => {
          const textLower = contentText.toLowerCase();
          const titleMatches = textLower.includes(p.title.toLowerCase());
          const codeMatches = p.property_code ? textLower.includes(p.property_code.toLowerCase()) : false;
          return titleMatches || codeMatches;
        });

        if (matchedProperty) {
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
    console.error('Error inserting message:', msgError)
    return
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  const ownerCheck = await checkIsAccountOwner(senderPhone, accountId)
  if (ownerCheck.isOwner) {
    console.log(`[webhook] Intercepted message from CRM owner: ${senderPhone}`)
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
        const { error: insertErr } = await supabaseAdmin()
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: configOwnerUserId || null,
            name: name || `Contact ${normalizedImportPhone}`,
            phone: normalizedImportPhone,
            email: email || null,
            classification: 'Others',
            company: '',
            status: 'pending_review',
            source: 'WhatsApp',
          });
        
        if (insertErr) {
          console.error('[webhook] Failed to auto-insert shared contact:', insertErr);
        } else {
          importedNames.push(name || normalizedImportPhone);
        }
      } else {
        importedNames.push(`${existingContact.name} (already in CRM)`);
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
          }).eq('id', conversation.id);
        }
      } catch (err) {
        console.error('[webhook] Failed to send contact import confirmation auto-reply:', err);
      }
    }
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
        })
        .eq('id', conversation.id)

      console.log(`[webhook] Automated calendar reply successfully sent to ${senderPhone}`)
    } catch (sendErr) {
      console.error('[webhook] Failed to send automated calendar reply:', sendErr)
    }

    return
  }

  if (interactiveReplyId) {
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
    } else if (interactiveReplyId === 'browse_all_properties') {
      await handleBrowseAllProperties(
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      )
      return
    }
  }

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
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
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? message.text?.body ?? ''
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
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
}> {
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
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
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
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
          contentText: `📥 Shared Contact Cards:\n${summaries.join('\n')}`,
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
  location?: string | null
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

  const { data: contacts, error: contactsError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .like('phone', `%${phoneSuffix}`)

  if (contactsError) {
    console.error('Error fetching contacts:', contactsError)
    return null
  }

  const existingContact = contacts?.find((c: ContactRow) => phonesMatch(c.phone, phone))

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
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

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    return existing
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating conversation:', createError)
    return null
  }

  return newConv
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

    const locationParts = [
      typedProperty.sublocality?.trim(),
      typedProperty.city?.trim()
    ].filter(Boolean).join(', ') || typedProperty.location

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const showcaseUrl = `${baseUrl}/?property_id=${typedProperty.id}`

    let detailsText = `🏠 *${typedProperty.title}*\n`
    if (formattedPrice) detailsText += `💰 *Price:* ${formattedPrice}\n`
    if (locationParts) detailsText += `📍 *Location:* ${locationParts}\n`
    if (areaStr) detailsText += `📐 *Area:* ${areaStr}\n`
    if (typedProperty.bedrooms) detailsText += `🛏️ *BHK:* ${typedProperty.bedrooms} BHK\n`
    if (typedProperty.bathrooms) detailsText += `🛁 *Bathrooms:* ${typedProperty.bathrooms}\n`
    if (typedProperty.description) detailsText += `\n📝 *Description:*\n${typedProperty.description}\n`
    
    if (typedProperty.google_map_link) {
      detailsText += `\n🗺️ *Google Maps:* ${typedProperty.google_map_link}\n`
    }
    detailsText += `\n🔗 *View full listing showcase here:*\n${showcaseUrl}`

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
    const followUpText = `Would you like to explore other properties? Tap below to browse all available listings.`
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
        { id: 'browse_all_properties', title: 'Browse Properties' },
        { id: `share_property_no:${typedProperty.id}`, title: 'No Thanks' }
      ],
      senderType: 'bot',
    })

    console.log(`[webhook] Successfully shared property ${propertyId} with contact ${contactId}`)
  } catch (err) {
    console.error('[webhook] Failed in handlePropertyShareYesReply:', err)
  }
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
