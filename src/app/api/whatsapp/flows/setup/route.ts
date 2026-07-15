import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

async function resolveAccountId() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return { error: 'Your profile is not linked to an account.', status: 403 as const }
  }
  return { accountId, supabase }
}

export async function POST() {
  try {
    const resolved = await resolveAccountId()
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const flow = await setupPreferenceFlow({ accountId: resolved.accountId })
    return NextResponse.json({
      success: true,
      flow,
      endpoint_uri: flowsEndpointUri(resolved.accountId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flow setup failed'
    console.error('[flows/setup] error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  try {
    const resolved = await resolveAccountId()
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    // RLS-scoped read — the user can only see their own account's row.
    const { data: flow } = await resolved.supabase
      .from('whatsapp_meta_flows')
      .select('*')
      .eq('account_id', resolved.accountId)
      .eq('flow_key', PREFERENCE_FLOW_KEY)
      .maybeSingle()

    const published = await getPublishedPreferenceFlow(resolved.accountId)
    return NextResponse.json({
      flow: flow || null,
      is_published: Boolean(published),
      endpoint_uri: flowsEndpointUri(resolved.accountId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load flow status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
