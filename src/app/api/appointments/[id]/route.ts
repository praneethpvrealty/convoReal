import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
