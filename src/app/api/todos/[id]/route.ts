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
    const { title, description, due_date, priority, completed, contact_id, property_id } = body

    const { data: todo, error } = await supabase
      .from('todos')
      .update({
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
        due_date: due_date !== undefined ? due_date : undefined,
        priority: priority !== undefined ? priority : undefined,
        completed: completed !== undefined ? completed : undefined,
        contact_id: contact_id !== undefined ? contact_id : undefined,
        property_id: property_id !== undefined ? property_id : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(todo)
  } catch (error) {
    console.error('Error updating todo:', error)
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
      .from('todos')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting todo:', error)
    return toErrorResponse(error)
  }
}
