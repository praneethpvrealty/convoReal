import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants } from '@/lib/whatsapp/phone-utils'

export async function checkAndSendAppointmentReminders(): Promise<void> {
  const admin = supabaseAdmin()
  const now = new Date()
  const target24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  
  // Query scheduled appointments starting in the next 24 hours that haven't sent at least one reminder
  const { data: appointments, error } = await admin
    .from('appointments')
    .select('*, contact:contacts(*), property:properties(id, title, location, sublocality), account:accounts(name)')
    .eq('status', 'scheduled')
    .gt('start_time', now.toISOString())
    .lte('start_time', target24h.toISOString())
    .or('reminder_24h_sent.eq.false,reminder_2h_sent.eq.false')

  if (error) {
    console.error('[Reminder Cron] Error fetching appointments:', error)
    return
  }

  if (!appointments || appointments.length === 0) {
    return
  }

  const target2h = new Date(now.getTime() + 2 * 60 * 60 * 1000)

  for (const appt of appointments) {
    const startTimeDate = new Date(appt.start_time)
    const isDue2h = startTimeDate <= target2h && !appt.reminder_2h_sent
    // Send 24h reminder if start_time is between 2h and 24h, and 24h reminder is not sent
    const isDue24h = startTimeDate <= target24h && startTimeDate > target2h && !appt.reminder_24h_sent

    // If neither is due, skip
    if (!isDue2h && !isDue24h) continue

    const reminderType = isDue2h ? '2h' : '24h'
    console.log(`[Reminder Cron] Sending ${reminderType} reminder for appointment "${appt.title}" (ID: ${appt.id})`)

    // Verify contact has a valid phone
    const contact = appt.contact
    if (!contact || !contact.phone) {
      console.warn(`[Reminder Cron] Contact missing or has no phone for appointment: ${appt.id}`)
      // Mark as sent so we don't keep checking it
      await admin
        .from('appointments')
        .update(isDue2h ? { reminder_2h_sent: true } : { reminder_24h_sent: true })
        .eq('id', appt.id)
      continue
    }

    // Get WhatsApp configuration for the account
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', appt.account_id)
      .maybeSingle()

    if (!config || !config.phone_number_id || !config.access_token) {
      console.warn(`[Reminder Cron] WhatsApp not configured for account: ${appt.account_id}`)
      continue
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (decryptErr) {
      console.error(`[Reminder Cron] Failed to decrypt access token for account: ${appt.account_id}`, decryptErr)
      continue
    }

    // Check if the template exists in message_templates
    const { data: templates } = await admin
      .from('message_templates')
      .select('*')
      .eq('account_id', appt.account_id)
      .eq('name', 'property_visit_reminder')
      .limit(1)

    const templateRow = templates?.[0]
    
    // Format the time parameter nicely in IST timezone
    const formattedTime = startTimeDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      console.warn(`[Reminder Cron] Invalid phone format: ${contact.phone}`)
      // Mark as sent to prevent infinite loops
      await admin
        .from('appointments')
        .update(isDue2h ? { reminder_2h_sent: true } : { reminder_24h_sent: true })
        .eq('id', appt.id)
      continue
    }

    const accountName = (appt.account as { name: string } | null)?.name || 'our team'

    // Try variants (e.g. adding country code prefix)
    const variants = phoneVariants(sanitizedPhone)
    let sentMessageId: string | null = null
    let lastError: string | null = null

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          templateName: 'property_visit_reminder',
          language: 'en_US',
          template: templateRow ?? undefined,
          params: [
            contact.name || 'Client',
            appt.property?.title || appt.title || 'Property visit',
            formattedTime,
            appt.location || 'Scheduled Location',
            accountName
          ]
        })
        sentMessageId = result.messageId
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (sentMessageId) {
      console.log(`[Reminder Cron] Successfully sent reminder. Msg ID: ${sentMessageId}`)
      
      // Update appointment reminder status
      await admin
        .from('appointments')
        .update(isDue2h ? { reminder_2h_sent: true } : { reminder_24h_sent: true })
        .eq('id', appt.id)

      // Find or create conversation to log in inbox thread
      try {
        let { data: conversation } = await admin
          .from('conversations')
          .select('id')
          .eq('account_id', appt.account_id)
          .eq('contact_id', contact.id)
          .maybeSingle()

        if (!conversation) {
          const { data: newConv } = await admin
            .from('conversations')
            .insert({
              account_id: appt.account_id,
              user_id: appt.user_id,
              contact_id: contact.id
            })
            .select('id')
            .single()
          conversation = newConv
        }

        if (conversation) {
          const bodyText = `Hi ${contact.name || 'Client'}, this is a friendly reminder for your scheduled property visit for "${appt.property?.title || appt.title || 'Property visit'}" on ${formattedTime}. Location: ${appt.location || 'Scheduled Location'}. Regards, ${accountName}.`
          
          await admin.from('messages').insert({
            conversation_id: conversation.id,
            sender_type: 'agent',
            content_type: 'template',
            content_text: bodyText,
            template_name: 'property_visit_reminder',
            message_id: sentMessageId,
            status: 'sent'
          })

          await admin.from('conversations').update({
            last_message_text: bodyText,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', conversation.id)
        }
      } catch (dbErr) {
        console.error('[Reminder Cron] Failed to log reminder to DB:', dbErr)
      }
    } else {
      console.error(`[Reminder Cron] Failed to send reminder to ${contact.phone}. Error:`, lastError)
      // Note: we don't mark as sent here so that we can retry on next cron tick if it was a transient error.
    }
  }
}
