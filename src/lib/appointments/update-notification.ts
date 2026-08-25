import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReminderTemplateContent, formatReminderTime, reminderLocationText } from '@/lib/appointments/reminder'
import { isReengagementError } from '@/lib/whatsapp/customer-window'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { loadTemplateForContact } from '@/lib/whatsapp/template-language'

export type AppointmentNotificationScope = 'new' | 'all'

interface AppointmentForNotification {
  id: string
  account_id: string
  user_id?: string | null
  title: string
  start_time: string
  location?: string | null
  event_type?: string | null
  agenda?: string | null
  property?: {
    title?: string | null
    type?: string | null
    location_privacy?: string | null
    location?: string | null
    sublocality?: string | null
    city?: string | null
    state?: string | null
  } | null
}

interface NotificationContact {
  id: string
  name: string | null
  phone: string | null
}

export function notificationRecipientIds(args: {
  previousIds: readonly string[]
  currentIds: readonly string[]
  scope: AppointmentNotificationScope
}): string[] {
  const previous = new Set(args.previousIds)
  return [...new Set(args.currentIds)].filter(
    (id) => args.scope === 'all' || !previous.has(id),
  )
}

export function appointmentUpdateMessage(args: {
  contactName: string
  accountName: string
  appointment: AppointmentForNotification
  isNewParticipant: boolean
}): string {
  const intro = args.isNewParticipant
    ? `You have been added to an event by ${args.accountName}.`
    : `An event you are participating in has been updated by ${args.accountName}.`
  const location = reminderLocationText(
    args.appointment.location,
    args.appointment.property,
  )
  return [
    `Hi ${args.contactName},`,
    intro,
    `Event: ${args.appointment.title}`,
    `When: ${formatReminderTime(args.appointment.start_time)}`,
    `Location: ${location}`,
    args.appointment.agenda ? `Agenda: ${args.appointment.agenda.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function sendAppointmentUpdateNotifications(args: {
  db: SupabaseClient
  appointment: AppointmentForNotification
  previousContactIds: readonly string[]
  currentContactIds: readonly string[]
  scope: AppointmentNotificationScope
}): Promise<{ sent: number; failed: number; recipients: number }> {
  const recipientIds = notificationRecipientIds({
    previousIds: args.previousContactIds,
    currentIds: args.currentContactIds,
    scope: args.scope,
  })
  if (recipientIds.length === 0) return { sent: 0, failed: 0, recipients: 0 }

  const [{ data: contacts }, { data: account }] = await Promise.all([
    args.db
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', args.appointment.account_id)
      .in('id', recipientIds),
    args.db
      .from('accounts')
      .select('name')
      .eq('id', args.appointment.account_id)
      .maybeSingle(),
  ])
  const rows = (contacts ?? []) as NotificationContact[]
  const accountName = account?.name || 'our team'
  const previous = new Set(args.previousContactIds)
  let sent = 0
  let failed = recipientIds.length - rows.length

  for (const contact of rows) {
    if (!contact.phone) {
      failed += 1
      continue
    }
    const clientName = contact.name || 'there'
    const text = appointmentUpdateMessage({
      contactName: clientName,
      accountName,
      appointment: args.appointment,
      isNewParticipant: !previous.has(contact.id),
    })
    let result = await sendWhatsAppMessageAndPersist({
      accountId: args.appointment.account_id,
      userId: args.appointment.user_id ?? null,
      contactId: contact.id,
      kind: 'text',
      senderType: 'agent',
      text,
      customDbClient: args.db,
    })

    if (!result.success && isReengagementError(result.error)) {
      const reminder = buildReminderTemplateContent({
        clientName,
        accountName,
        title: args.appointment.property?.title || args.appointment.title,
        formattedTime: formatReminderTime(args.appointment.start_time),
        locationText: reminderLocationText(
          args.appointment.location,
          args.appointment.property,
        ),
        agenda: args.appointment.agenda,
        isSiteVisit: args.appointment.event_type === 'site_visit',
      })
      const { template } = await loadTemplateForContact(args.db, {
        accountId: args.appointment.account_id,
        contactId: contact.id,
        names: [reminder.templateName],
      })
      result = await sendWhatsAppMessageAndPersist({
        accountId: args.appointment.account_id,
        userId: args.appointment.user_id ?? null,
        contactId: contact.id,
        kind: 'template',
        senderType: 'agent',
        templateName: reminder.templateName,
        templateLanguage: template?.language || 'en_US',
        templateParams: reminder.templateParams,
        text: reminder.bodyText,
        customDbClient: args.db,
      })
    }

    if (result.success) sent += 1
    else failed += 1
  }

  return { sent, failed, recipients: recipientIds.length }
}
