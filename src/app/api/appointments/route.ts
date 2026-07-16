import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
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

    // Fetch all appointments for this account, joining contact and property info
    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .eq('account_id', accountId)
      .order('start_time', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(appointments)
  } catch (error) {
    console.error('Error fetching appointments:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
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
      contact_ids,
      property_id,
      title,
      description,
      start_time,
      end_time,
      location,
      status,
    } = body

    // Accept either shape: a contact_ids array, a single contact_id,
    // or both. contact_id stays the primary (first) contact.
    const allContactIds: string[] = Array.isArray(contact_ids)
      ? contact_ids.filter((id: unknown): id is string => typeof id === 'string')
      : []
    if (contact_id && !allContactIds.includes(contact_id)) {
      allContactIds.unshift(contact_id)
    }

    if (!title || !start_time || !end_time) {
      return NextResponse.json(
        { error: 'title, start_time, and end_time are required' },
        { status: 400 }
      )
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert({
        account_id: accountId,
        user_id: user.id,
        contact_id: allContactIds[0] || null,
        contact_ids: allContactIds,
        property_id: property_id || null,
        title,
        description: description || null,
        start_time,
        end_time,
        location: location || null,
        status: status || 'scheduled',
      })
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(appointment, { status: 201 })
  } catch (error) {
    console.error('Error creating appointment:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
