import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

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
      property_id,
      title,
      description,
      start_time,
      end_time,
      location,
      status,
    } = body

    const updatePayload: Record<string, unknown> = {
      contact_id: contact_id !== undefined ? contact_id : undefined,
      property_id: property_id !== undefined ? property_id : undefined,
      title: title !== undefined ? title : undefined,
      description: description !== undefined ? description : undefined,
      start_time: start_time !== undefined ? start_time : undefined,
      end_time: end_time !== undefined ? end_time : undefined,
      location: location !== undefined ? location : undefined,
      status: status !== undefined ? status : undefined,
      updated_at: new Date().toISOString(),
    }

    // Moving an appointment to a new time must re-arm its reminders —
    // otherwise an appointment whose 1h/morning reminder already fired
    // for its OLD time silently never reminds again after being
    // rescheduled, since reminder_morning_sent/reminder_1h_sent only
    // ever get set to true (src/lib/appointments/reminder.ts) and
    // nothing else resets them.
    if (start_time !== undefined) {
      const { data: existing } = await supabase
        .from('appointments')
        .select('start_time')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (existing && new Date(existing.start_time).getTime() !== new Date(start_time).getTime()) {
        updatePayload.reminder_morning_sent = false
        updatePayload.reminder_1h_sent = false
        // A reschedule also resolves any pending "Requesting reschedule"
        // flag (src/lib/whatsapp/webhook-handler.ts) — the client's ask
        // is addressed by definition once the time actually changes.
        updatePayload.reschedule_requested_at = null
        // And voids any earlier "Fine" confirmation — it was for the
        // old time; the re-sent reminders will collect a fresh one.
        updatePayload.client_confirmed_at = null
      }
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .update(updatePayload)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(appointment)
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

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting appointment:', error)
    return toErrorResponse(error)
  }
}
