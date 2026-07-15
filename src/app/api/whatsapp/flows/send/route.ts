import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPreferenceFlowToContact } from '@/lib/whatsapp/meta-flow-service'

/**
 * POST /api/whatsapp/flows/send
 * Body: { contact_id: string }
 *
 * Agent-initiated send of the Buyer Preference Intake flow to a
 * contact's WhatsApp. Buyers can also trigger it themselves by texting
 * "update my preferences" (see webhook-handler.ts).
 */
export async function POST(request: NextRequest) {
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
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    const contactId = body?.contact_id
    if (!contactId || typeof contactId !== 'string') {
      return NextResponse.json({ error: 'contact_id is required.' }, { status: 400 })
    }

    // RLS-scoped ownership check before switching to the service role.
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    }

    const result = await sendPreferenceFlowToContact({
      accountId,
      contactId,
      senderType: 'agent',
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send flow'
    console.error('[flows/send] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
