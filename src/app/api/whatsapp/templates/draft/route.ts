// ============================================================
// POST /api/whatsapp/templates/draft
//
// Persist a template locally WITHOUT sending it to Meta.
//
// The submit route is one-way: it posts to Meta and writes the row in
// the same breath, which is right for English copy the account has
// always been able to send in one tap. A translated Engine template
// needs a step in between — somebody who reads the language has to
// look at the words first (see translation-review.ts) — and there is
// nowhere to hold it while they do.
//
// So: this creates the DRAFT row from the same builder payload, the
// agent reads and edits it in the normal template dialog, marks it
// reviewed, and only then does the submit route let it through.
// ============================================================

import { NextResponse } from 'next/server'

import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { withAccountShowcaseButtons } from '@/lib/whatsapp/template-showcase-buttons'
import { stampFor } from '@/lib/whatsapp/copy-revision-stamp'
import { withMetaHeldCategory } from '@/lib/whatsapp/template-category-lock'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  // Same authority as submitting: templates are account-wide and go
  // out under the one WhatsApp number. Resolved outside the main try
  // so a 401/403 does not collapse into a generic 500.
  let ctx: AccountContext
  try {
    ctx = await requireOrgRole('org_manager')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, userId, accountId } = ctx

  try {
    const limit = await checkRateLimit(
      `admin:templateDraft:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    // Same showcase-button rewrite the submit route applies, so the
    // draft the reviewer reads is byte-for-byte what would be sent.
    payload = await withAccountShowcaseButtons(supabase, accountId, payload)

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    // Never clobber a row that already exists for this (name,
    // language): it may be approved and sending, or it may hold edits
    // a reviewer already made. Re-creating a draft over either would
    // be silent data loss.
    const { data: existing } = await supabase
      .from('message_templates')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('name', payload.name)
      .eq('language', payload.language)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        {
          error: 'This template already exists in that language.',
          code: 'ALREADY_EXISTS',
          id: existing.id,
        },
        { status: 409 },
      )
    }

    // A draft wears the category it will be submitted under. Meta
    // fixes a name's category at its first review, so when another
    // language of this template already reached Meta the draft takes
    // that category rather than the builder's request — the submit
    // route would send it that way regardless, and the badge the
    // reviewer reads should not promise Utility on a Marketing name.
    const requestedCategory = payload.category
    const { data: siblings, error: siblingsError } = await supabase
      .from('message_templates')
      .select('category, meta_template_id, status')
      .eq('account_id', accountId)
      .eq('name', payload.name)
      .not('meta_template_id', 'is', null)
    if (siblingsError) {
      console.error('[templates/draft] category lookup error:', siblingsError)
      return NextResponse.json(
        { error: 'Could not confirm the category Meta holds for this template. Try again.' },
        { status: 500 },
      )
    }
    payload = withMetaHeldCategory(payload, siblings ?? []).payload

    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: payload.name,
        category: payload.category,
        language: payload.language,
        header_type: payload.header_type ?? null,
        header_content: payload.header_content ?? null,
        header_media_url: payload.header_media_url ?? null,
        body_text: payload.body_text,
        footer_text: payload.footer_text ?? null,
        buttons: payload.buttons ?? null,
        sample_values: payload.sample_values ?? null,
        status: 'DRAFT',
        // Explicitly unreviewed. The submit route reads this.
        translation_reviewed_at: null,
        // Which shipped wording this started from (migration 252), so
        // a later improvement to the copy can tell "they reworded it"
        // from "ours moved on". Null for an account-authored template,
        // which has no shipped copy to drift from. No prior origin to
        // preserve — this route refuses to write over an existing row.
        copy_revision: stampFor(payload.name, payload.language, payload, null),
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[POST /api/whatsapp/templates/draft] insert error:', error)
      return NextResponse.json(
        { error: error?.message ?? 'Failed to create draft' },
        { status: 500 },
      )
    }

    return NextResponse.json(
      {
        data: { id: data.id },
        ...(payload.category !== requestedCategory
          ? {
              category_changed: {
                requested: requestedCategory,
                assigned: payload.category,
              },
            }
          : {}),
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
