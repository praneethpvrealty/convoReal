import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  sendAppointmentUpdateNotifications,
  type AppointmentNotificationScope,
} from '@/lib/appointments/update-notification'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('agent')

    const body = await request.json()
    const {
      contact_id,
      contact_ids,
      property_id,
      title,
      description,
      start_time,
      end_time,
      location,
      status,
      event_type,
      assigned_to,
      agenda,
      minutes,
      outcome,
      notify_participants,
      notification_scope,
    } = body

    const { data: existing, error: existingError } = await supabase
      .from('appointments')
      .select('id, user_id, start_time, status, contact_id, contact_ids')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const requestedContactIds = Array.isArray(contact_ids)
      ? [...new Set(contact_ids.filter((value: unknown): value is string => typeof value === 'string'))]
      : null
    if (contact_id && requestedContactIds && !requestedContactIds.includes(contact_id)) {
      requestedContactIds.unshift(contact_id)
    }
    if (requestedContactIds) {
      const { data: validContacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .in('id', requestedContactIds)
      if ((validContacts ?? []).length !== requestedContactIds.length) {
        return NextResponse.json({ error: 'One or more participants are invalid' }, { status: 400 })
      }
    }

    const updatePayload: Record<string, unknown> = {
      contact_id: contact_id !== undefined ? contact_id : undefined,
      contact_ids: requestedContactIds ?? undefined,
      property_id: property_id !== undefined ? property_id : undefined,
      title: title !== undefined ? title : undefined,
      description: description !== undefined ? description : undefined,
      start_time: start_time !== undefined ? start_time : undefined,
      end_time: end_time !== undefined ? end_time : undefined,
      location: location !== undefined ? location : undefined,
      status: status !== undefined ? status : undefined,
      event_type: event_type !== undefined ? event_type : undefined,
      assigned_to: assigned_to !== undefined ? assigned_to : undefined,
      agenda: agenda !== undefined ? agenda : undefined,
      minutes: minutes !== undefined ? minutes : undefined,
      outcome: outcome !== undefined ? outcome : undefined,
      updated_at: new Date().toISOString(),
    }

    // Moving an appointment to a new time must re-arm its reminders —
    // otherwise an appointment whose 1h/morning reminder already fired
    // for its OLD time silently never reminds again after being
    // rescheduled, since reminder_morning_sent/reminder_1h_sent only
    // ever get set to true (src/lib/appointments/reminder.ts) and
    // nothing else resets them. Reopening a finished or cancelled
    // appointment re-arms them the same way.
    const rescheduled =
      start_time !== undefined &&
      new Date(existing.start_time).getTime() !== new Date(start_time).getTime()
    const reopened = status === 'scheduled' && existing.status !== 'scheduled'
    const closed =
      status !== undefined && status !== 'scheduled' && existing.status === 'scheduled'
    // Only a start still ahead is worth reminding about: reopening
    // yesterday's cancelled visit must not message its contacts.
    const startsAhead =
      new Date(start_time !== undefined ? start_time : existing.start_time).getTime() > Date.now()
    if (rescheduled) {
      // A reschedule also resolves any pending "Requesting reschedule"
      // flag (src/lib/whatsapp/webhook-handler.ts) — the client's ask
      // is addressed by definition once the time actually changes.
      updatePayload.reschedule_requested_at = null
      // And voids any earlier "Fine" confirmation — it was for the
      // old time; the re-sent reminders will collect a fresh one.
      updatePayload.client_confirmed_at = null
    }
    if (closed) {
      // Done or Cancel: nothing changes for the sweep, which only reads
      // scheduled rows, but a reminder it already fetched or queued
      // for this event must not go out now that the event is closed.
      updatePayload.reminders_rearmed_at = new Date().toISOString()
    }
    if ((rescheduled || reopened) && !startsAhead) {
      // A reminder that never went out for a visit now behind us must
      // not go out on the next sweep either, and one already queued or
      // mid-sweep for the old time must not go out at all: the stamp
      // supersedes it while the flags keep the sweep away.
      updatePayload.reminder_morning_sent = true
      updatePayload.reminder_1h_sent = true
      updatePayload.reminders_rearmed_at = new Date().toISOString()
    }
    if ((rescheduled || reopened) && startsAhead) {
      updatePayload.reminder_morning_sent = false
      updatePayload.reminder_1h_sent = false
      // The flags alone re-arm nothing: each send first claims an
      // (appointment, recipient, type) row in appointment_reminder_log,
      // and a claim left from the earlier send would make the cron flip
      // the flag straight back without sending. The re-arm instant goes
      // in the same write as the flags, so it either lands with them or
      // not at all; the cron takes over any claim made before it
      // (src/lib/appointments/reminder.ts) and a voice note queued under
      // such a claim is dropped (src/lib/voice/reminder-audio-worker.ts).
      updatePayload.reminders_rearmed_at = new Date().toISOString()
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .update(updatePayload)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, type, location_privacy, location, sublocality, city, state)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let notifications = null
    if (notify_participants === true) {
      const scope: AppointmentNotificationScope =
        notification_scope === 'all' ? 'all' : 'new'
      const previousContactIds = existing.contact_ids?.length
        ? existing.contact_ids
        : existing.contact_id
          ? [existing.contact_id]
          : []
      const currentContactIds = appointment.contact_ids?.length
        ? appointment.contact_ids
        : appointment.contact_id
          ? [appointment.contact_id]
          : []
      try {
        notifications = await sendAppointmentUpdateNotifications({
          db: supabaseAdmin(),
          appointment,
          previousContactIds,
          currentContactIds,
          scope,
        })
      } catch (notificationError) {
        console.error('Appointment updated but participant notifications failed:', notificationError)
        const previousSet = new Set(previousContactIds)
        const recipients = currentContactIds.filter(
          (contactId: string) => scope === 'all' || !previousSet.has(contactId),
        ).length
        notifications = { sent: 0, failed: recipients, recipients }
      }
    }

    return NextResponse.json({ appointment, notifications })
  } catch (error) {
    console.error('Error updating appointment:', error)
    return toErrorResponse(error)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('agent')

    const { data, error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data?.length) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting appointment:', error)
    return toErrorResponse(error)
  }
}
