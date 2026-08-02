import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
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
  // Outside the main try, whose catch surfaces the Meta error message
  // as a 500. Sending a flow puts a WhatsApp message on the account's
  // behalf, so it carries the same 'agent' gate as /api/whatsapp/send.
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase']
  let accountId: string
  try {
    ;({ supabase, accountId } = await requireRole('agent'))
  } catch (error) {
    return toErrorResponse(error)
  }

  try {
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
