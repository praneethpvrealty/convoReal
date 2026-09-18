import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const dealId = new URL(request.url).searchParams.get('deal_id')?.trim()

    // Fetch all todos for this account, joining contact and property info
    let query = supabase
      .from('todos')
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .eq('account_id', accountId)
    if (dealId) query = query.eq('deal_id', dealId)
    const { data: todos, error } = await query.order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(todos)
  } catch (error) {
    console.error('Error fetching todos:', error)
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = await request.json()
    const { title, description, due_date, priority, contact_id, property_id, deal_id } = body

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const { data: todo, error } = await supabase
      .from('todos')
      .insert({
        account_id: accountId,
        user_id: userId,
        title,
        description: description || null,
        due_date: due_date || null,
        priority: priority || 'medium',
        completed: false,
        contact_id: contact_id || null,
        property_id: property_id || null,
        deal_id: deal_id || null,
      })
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(todo, { status: 201 })
  } catch (error) {
    console.error('Error creating todo:', error)
    return toErrorResponse(error)
  }
}
