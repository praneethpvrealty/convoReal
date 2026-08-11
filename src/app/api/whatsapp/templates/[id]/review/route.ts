// ============================================================
// POST   /api/whatsapp/templates/[id]/review — sign this copy off
// DELETE /api/whatsapp/templates/[id]/review — withdraw the sign-off
//
// The human half of the translation gate. Somebody who reads the
// language says "these words are fine to send under our name", and
// the submit route stops refusing.
//
// Withdrawing exists because a reviewer can be wrong, or a second
// reader can disagree, and the alternative — editing a character to
// trip the reset trigger in migration 244 — is a worse way to say the
// same thing.
// ============================================================

import { NextResponse } from 'next/server'

import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'

async function setReview(
  request: Request,
  params: Promise<{ id: string }>,
  reviewed: boolean,
) {
  let ctx: AccountContext
  try {
    ctx = await requireOrgRole('org_manager')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, userId, accountId } = ctx

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing template id' }, { status: 400 })
    }

    // .select() is load-bearing: an RLS refusal returns zero rows and
    // no error, so without it a refused write would report success and
    // the gate would look open when it is not.
    const { data, error } = await supabase
      .from('message_templates')
      .update({
        translation_reviewed_at: reviewed ? new Date().toISOString() : null,
        translation_reviewed_by: reviewed ? userId : null,
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, translation_reviewed_at')

    if (error) {
      console.error('[templates/review] update error:', error)
      return NextResponse.json(
        { error: 'Failed to update review state' },
        { status: 500 },
      )
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ data: data[0] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return setReview(request, params, true)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return setReview(request, params, false)
}
