import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  setupPreferenceFlow,
  getPublishedPreferenceFlow,
  flowsEndpointUri,
} from '@/lib/whatsapp/meta-flow-service'
import { PREFERENCE_FLOW_KEY } from '@/lib/whatsapp/preference-flow'

/**
 * Native Meta WhatsApp Flows — setup & status for the Buyer Preference
 * Intake flow.
 *
 * POST — generate/register encryption keys, create the flow on Meta,
 *        upload the latest Flow JSON, and publish it. Idempotent.
 * GET  — current registry row for this account (or null).
 */

export async function POST() {
  // Outside the main try, whose catch surfaces the Meta error message
  // as a 400.
  let accountId: string
  try {
    ;({ accountId } = await getCurrentAccount())
  } catch (error) {
    return toErrorResponse(error)
  }

  try {
    const flow = await setupPreferenceFlow({ accountId })
    return NextResponse.json({
      success: true,
      flow,
      endpoint_uri: flowsEndpointUri(accountId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flow setup failed'
    console.error('[flows/setup] error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  let supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase']
  let accountId: string
  try {
    ;({ supabase, accountId } = await getCurrentAccount())
  } catch (error) {
    return toErrorResponse(error)
  }

  try {
    // RLS-scoped read — the user can only see their own account's row.
    const { data: flow } = await supabase
      .from('whatsapp_meta_flows')
      .select('*')
      .eq('account_id', accountId)
      .eq('flow_key', PREFERENCE_FLOW_KEY)
      .maybeSingle()

    const published = await getPublishedPreferenceFlow(accountId)
    return NextResponse.json({
      flow: flow || null,
      is_published: Boolean(published),
      endpoint_uri: flowsEndpointUri(accountId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load flow status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
