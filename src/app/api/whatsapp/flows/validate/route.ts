import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validatePreferenceFlowJson } from '@/lib/whatsapp/meta-flow-service'

/**
 * POST /api/whatsapp/flows/validate
 *
 * Uploads the Buyer Preference Intake Flow JSON to Meta and reports back
 * the real validation result — never publishes. Use this to check a
 * change to preference-flow.ts against Meta's actual rules before
 * running the (live-affecting) /api/whatsapp/flows/setup publish.
 */
export async function POST() {
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

    const result = await validatePreferenceFlowJson({ accountId })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flow validation failed'
    console.error('[flows/validate] error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
