import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
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
  // Outside the main try, whose catch reports every failure as a Meta
  // validation error. This route never publishes, so it carries no
  // role gate beyond a live account.
  let accountId: string
  try {
    ;({ accountId } = await getCurrentAccount())
  } catch (error) {
    return toErrorResponse(error)
  }

  try {
    const result = await validatePreferenceFlowJson({ accountId })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flow validation failed'
    console.error('[flows/validate] error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
