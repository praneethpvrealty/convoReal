import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher'
import { istDayWindow, istHourOf } from '@/lib/calendar/whatsapp-scheduler'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Client-facing appointment reminders. Every appointment can now
// carry several contacts (buyer, partner agent, owner…) via
// contact_ids, and each reminder goes to ALL of them:
//
//   1. Morning-of brief once ~7 AM IST opens (reminder_morning_sent)
//   2. One hour before the meeting          (reminder_1h_sent)
//
// Delivery is tracked per recipient in appointment_reminder_log:
// a unique (appointment, contact, type) claim row is inserted
// before each send and released again if the send fails, so a
// partial failure retries ONLY the missed recipients on the next
// cron tick — no duplicates for the ones already reached. The
// appointment-level flag flips only once every reachable recipient
// is covered.
// ============================================================

const HOUR_MS = 60 * 60 * 1000

// Agenda-carrying template variant (seeded DRAFT by migration 129).
// Used only for accounts whose copy Meta has APPROVED; everyone else
// stays on the original 5-placeholder template.
const AGENDA_TEMPLATE_NAME = 'property_visit_reminder_agenda'

type ReminderType = 'morning' | '1h'

interface ReminderContact {
  id: string
  name: string | null
  phone: string | null
}

interface ReminderAppointment {
  id: string
  account_id: string
  user_id: string | null
  title: string
  start_time: string
  location: string | null
  agenda: string | null
  contact_id: string | null
  contact_ids: string[] | null
  reminder_morning_sent: boolean
  reminder_1h_sent: boolean
  property: { id: string; title: string | null } | null
  account: { name: string } | null
}

/** Union of the multi-contact array and the legacy single column. */
function recipientIds(appt: ReminderAppointment): string[] {
  const ids = new Set<string>(appt.contact_ids || [])
  if (appt.contact_id) ids.add(appt.contact_id)
  return [...ids]
}

/** Returns null on fetch failure so the caller can abort the tick —
 *  an empty map here must never be mistaken for "no recipients". */
async function loadContacts(
  admin: SupabaseClient,
  ids: string[]
): Promise<Map<string, ReminderContact> | null> {
  const map = new Map<string, ReminderContact>()
  if (ids.length === 0) return map
  const { data, error } = await admin.from('contacts').select('id, name, phone').in('id', ids)
  if (error) {
    console.error('[Reminder Cron] contacts fetch failed:', error)
    return null
  }
  for (const c of data || []) map.set(c.id, c as ReminderContact)
  return map
}

/** Meta rejects template params containing newlines/tabs, and long
 *  params can push the rendered body past its limit — flatten the
 *  free-text agenda into one bounded line. */
function sanitizeTemplateParam(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Sends one reminder to every contact attached to the appointment,
 * claiming each recipient in appointment_reminder_log first.
 * Returns true when every reachable recipient is covered (sent now
 * or on an earlier tick) — only then should the appointment-level
 * flag be marked, so missed recipients retry next tick.
 */
async function sendToAllRecipients(
  admin: SupabaseClient,
  appt: ReminderAppointment,
  contacts: Map<string, ReminderContact>,
  reminderType: ReminderType,
  useAgendaTemplate: boolean
): Promise<boolean> {
  const reachable = recipientIds(appt)
    .map((id) => contacts.get(id))
    .filter((c): c is ReminderContact => !!c && !!c.phone && isValidE164(sanitizePhoneForMeta(c.phone)))

  if (reachable.length === 0) {
    console.warn(`[Reminder Cron] No reachable contacts for appointment ${appt.id} (${reminderType})`)
    return true // nothing to retry — mark sent so we stop re-scanning it
  }

  const accountName = appt.account?.name || 'our team'
  const formattedTime = formatIstTime(appt.start_time)
  const agendaParam =
    useAgendaTemplate && appt.agenda ? sanitizeTemplateParam(appt.agenda) : null

  let allCovered = true
  for (const contact of reachable) {
    // Claim this recipient. A unique-violation means an earlier tick
    // already delivered (or another cron instance owns it) — skip.
    const { error: claimErr } = await admin.from('appointment_reminder_log').insert({
      account_id: appt.account_id,
      appointment_id: appt.id,
      contact_id: contact.id,
      reminder_type: reminderType,
    })
    if (claimErr) {
      if (claimErr.code !== '23505') {
        console.error('[Reminder Cron] claim insert failed:', claimErr)
        allCovered = false
      }
      continue
    }

    const clientName = contact.name || 'Client'
    const visitTitle = appt.property?.title || appt.title || 'Property visit'
    const locationText = appt.location || 'Scheduled Location'
    const bodyText = agendaParam
      ? `Hi ${clientName}, this is a friendly reminder for your scheduled property visit for "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Agenda: ${agendaParam}. Regards, ${accountName}.`
      : `Hi ${clientName}, this is a friendly reminder for your scheduled property visit for "${visitTitle}" on ${formattedTime}. Location: ${locationText}. Regards, ${accountName}.`

    const result = await sendWhatsAppMessageAndPersist({
      accountId: appt.account_id,
      userId: appt.user_id || null,
      contactId: contact.id,
      kind: 'template',
      senderType: 'agent', // reminders logged as sent by agent
      templateName: agendaParam ? AGENDA_TEMPLATE_NAME : 'property_visit_reminder',
      templateLanguage: 'en_US',
      templateParams: agendaParam
        ? [clientName, visitTitle, formattedTime, locationText, agendaParam, accountName]
        : [clientName, visitTitle, formattedTime, locationText, accountName],
      text: bodyText, // Store formatted preview text in DB
      customDbClient: admin,
    })

    if (result.success) {
      console.log(`[Reminder Cron] Sent ${reminderType} reminder for appt ${appt.id} to contact ${contact.id}`)
    } else {
      console.error(`[Reminder Cron] Failed ${reminderType} reminder to ${contact.phone}:`, result.error)
      allCovered = false
      // Release the claim so the next tick retries this recipient.
      await admin
        .from('appointment_reminder_log')
        .delete()
        .eq('appointment_id', appt.id)
        .eq('contact_id', contact.id)
        .eq('reminder_type', reminderType)
    }
  }
  return allCovered
}

export async function checkAndSendAppointmentReminders(now: Date = new Date()): Promise<void> {
  const admin = supabaseAdmin()
  const oneHourOut = new Date(now.getTime() + HOUR_MS)
  const { endIso: dayEndIso } = istDayWindow(now)
  const dayEndMs = new Date(dayEndIso).getTime()
  const morningWindowOpen = istHourOf(now) >= 7

  // One fetch covers both passes: everything left today (IST) plus
  // anything inside the 1h window that spills past IST midnight.
  const horizonIso = new Date(Math.max(dayEndMs, oneHourOut.getTime())).toISOString()

  const { data: appointments, error } = await admin
    .from('appointments')
    .select(
      'id, account_id, user_id, title, start_time, location, agenda, contact_id, contact_ids, reminder_morning_sent, reminder_1h_sent, property:properties(id, title), account:accounts(name)'
    )
    .eq('status', 'scheduled')
    .gt('start_time', now.toISOString())
    .lte('start_time', horizonIso)
    .or('reminder_morning_sent.eq.false,reminder_1h_sent.eq.false')

  if (error) {
    console.error('[Reminder Cron] Error fetching appointments:', error)
    return
  }
  if (!appointments || appointments.length === 0) return

  const rows = appointments as unknown as ReminderAppointment[]
  const contacts = await loadContacts(admin, [...new Set(rows.flatMap(recipientIds))])
  if (!contacts) return // transient failure — retry the whole tick later

  // Accounts whose agenda-carrying template variant Meta has approved
  // get the agenda in client reminders; everyone else stays on the
  // original template. A lookup failure just means "fall back" — it
  // must never block the reminders themselves.
  const agendaAccounts = new Set<string>()
  const apptsWithAgenda = rows.filter((r) => r.agenda)
  if (apptsWithAgenda.length > 0) {
    const { data: agendaTemplates, error: tplErr } = await admin
      .from('message_templates')
      .select('account_id')
      .eq('name', AGENDA_TEMPLATE_NAME)
      .eq('status', 'APPROVED')
      .in('account_id', [...new Set(apptsWithAgenda.map((r) => r.account_id))])
    if (tplErr) {
      console.warn('[Reminder Cron] agenda template lookup failed, using base template:', tplErr)
    }
    for (const t of agendaTemplates || []) agendaAccounts.add(t.account_id as string)
  }

  for (const appt of rows) {
    const msUntilStart = new Date(appt.start_time).getTime() - now.getTime()
    const isDue1h = !appt.reminder_1h_sent && msUntilStart <= HOUR_MS
    // Morning-of brief: fires once the 7 AM IST window opens, for
    // today's events still more than an hour away (the 1h reminder
    // covers anything closer — two near-identical messages back to
    // back reads spammy).
    const isDueMorning =
      !appt.reminder_morning_sent &&
      morningWindowOpen &&
      msUntilStart > HOUR_MS &&
      new Date(appt.start_time).getTime() < dayEndMs

    const useAgendaTemplate = agendaAccounts.has(appt.account_id)

    if (isDue1h) {
      const covered = await sendToAllRecipients(admin, appt, contacts, '1h', useAgendaTemplate)
      if (covered) {
        // An event that got its 1h reminder no longer needs the
        // morning one — mark both so it drops out of the scan.
        await admin
          .from('appointments')
          .update({ reminder_1h_sent: true, reminder_morning_sent: true })
          .eq('id', appt.id)
      }
    } else if (isDueMorning) {
      const covered = await sendToAllRecipients(admin, appt, contacts, 'morning', useAgendaTemplate)
      if (covered) {
        await admin.from('appointments').update({ reminder_morning_sent: true }).eq('id', appt.id)
      }
    }
  }
}
