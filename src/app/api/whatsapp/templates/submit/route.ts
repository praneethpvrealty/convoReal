import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  submitMessageTemplate,
  uploadSampleMedia,
} from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { withAccountShowcaseButtons } from '@/lib/whatsapp/template-showcase-buttons'
import {
  normalizeCategory,
  normalizeStatus,
} from '@/lib/whatsapp/template-status-normalize'
import {
  requiresTranslationReview,
  isTranslationReviewed,
  TRANSLATION_REVIEW_REQUIRED_MESSAGE,
  TRANSLATION_REVIEW_MISSING_DRAFT_MESSAGE,
} from '@/lib/whatsapp/translation-review'

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
    /** Category Meta actually assigned, when it returned one — Meta can
     *  approve a Utility submission as MARKETING, and the effective
     *  category is what frequency caps (error 131049) key off. */
    metaCategory?: TemplatePayload['category'] | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    // Original author — kept as audit only. The unique index is
    // still on (user_id, name, language) — see the upsert helper
    // for the cross-teammate dedup follow-up.
    user_id: userId,
    name: payload.name,
    category: extras.metaCategory ?? payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function upsertTemplateRow(
  supabase: SupabaseClient,
  row: ReturnType<typeof buildUpsertRow>,
) {
  // First, query if a template with the same (user_id, name, language) already exists.
  // This manual lookup-then-update/insert logic is robust against missing database-level
  // unique constraints/indexes, which can occur if there is duplicate legacy data.
  const { data: existing } = await supabase
    .from('message_templates')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('name', row.name)
    .eq('language', row.language)
    .maybeSingle()

  if (existing?.id) {
    return supabase
      .from('message_templates')
      .update(row)
      .eq('id', existing.id)
      .select()
      .single()
  } else {
    return supabase
      .from('message_templates')
      .insert(row)
      .select()
      .single()
  }
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (user_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — a row can only be
 * submitted; editing or deleting requires hsm_id and lives in PR 4.
 */
export async function POST(request: Request) {
  // Template management is org_manager-only (product decision, see
  // migration 146): templates go to Meta under the account's one
  // WhatsApp number and affect its quality rating. Resolved outside
  // the main try so a 401/403 doesn't collapse into the generic 500.
  let ctx: AccountContext
  try {
    ctx = await requireOrgRole('org_manager')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, userId, accountId } = ctx

  try {
    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    // Every buyer-facing link goes to the brokerage's own showcase.
    //
    // The engine-template builders take an origin, and each caller had
    // only `window.location.origin` to give them — the DASHBOARD's
    // host. So an account with its own subdomain submitted a
    // "View full details" button pointing at the shared site, and every
    // buyer who tapped it left the brokerage's showcase for the default
    // one. The account is known here and nowhere in the client, so this
    // is the one place that can be right for every template at once.
    payload = await withAccountShowcaseButtons(supabase, accountId, payload)

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    // The translation gate. Enforced here rather than only in the UI
    // because this route is the single door to Meta — the template
    // manager, the one-tap engine-template button and any script all
    // come through it, and machine-written copy reaching a real buyer
    // is exactly what the gate exists to stop.
    if (requiresTranslationReview(payload.name, payload.language)) {
      const { data: existing } = await supabase
        .from('message_templates')
        .select('translation_reviewed_at')
        .eq('account_id', accountId)
        .eq('name', payload.name)
        .eq('language', payload.language)
        .maybeSingle()

      if (!existing) {
        return NextResponse.json(
          {
            error: TRANSLATION_REVIEW_MISSING_DRAFT_MESSAGE,
            code: 'TRANSLATION_DRAFT_REQUIRED',
          },
          { status: 409 },
        )
      }
      if (!isTranslationReviewed(existing)) {
        return NextResponse.json(
          {
            error: TRANSLATION_REVIEW_REQUIRED_MESSAGE,
            code: 'TRANSLATION_REVIEW_REQUIRED',
          },
          { status: 409 },
        )
      }
    }

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string
    let metaCategory: TemplatePayload['category'] | null = null

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single()
      if (configError || !config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
          },
          { status: 400 },
        )
      }
      if (!config.waba_id) {
        return NextResponse.json(
          {
            error:
              'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
          },
          { status: 400 },
        )
      }

      const accessToken = decrypt(config.access_token)
      try {
        // Meta's create-template endpoint only accepts a Resumable
        // Upload handle as the sample for media headers — a plain URL
        // is rejected with "Missing sample parameter". When the payload
        // carries only a URL, fetch the sample and upload it for the
        // handle before building the components.
        if (
          payload.header_type &&
          payload.header_type !== 'text' &&
          !payload.header_handle &&
          payload.header_media_url
        ) {
          const sample = await fetch(payload.header_media_url)
          if (!sample.ok) {
            throw new Error(
              `Could not fetch the header sample (HTTP ${sample.status}) from ${payload.header_media_url}`,
            )
          }
          const fileType =
            sample.headers.get('content-type')?.split(';')[0] || 'image/png'
          payload.header_handle = await uploadSampleMedia({
            accessToken,
            data: await sample.arrayBuffer(),
            fileType,
          })
        }
        const meta = await submitMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          payload: buildMetaTemplatePayload(payload),
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
        metaCategory = meta.category ? normalizeCategory(meta.category) : null
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        // Persist the failure so the user can retry; row stays DRAFT
        // until they fix and re-submit.
        await upsertTemplateRow(
          supabase,
          buildUpsertRow(accountId, userId, payload, {
            status: 'DRAFT',
            metaTemplateId: null,
            submissionError: message,
          }),
        )
        const isRateLimit = /\b429\b/.test(message)
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 },
        )
      }
    }

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      buildUpsertRow(accountId, userId, payload, {
        status: normalizeStatus(metaStatus),
        metaTemplateId,
        submissionError: null,
        metaCategory,
      }),
    )

    if (upsertErr) {
      // The submit succeeded on Meta's side but we failed to persist
      // locally. That's a data-drift state — surface the meta_template_id
      // so the user can recover via "Sync from Meta".
      return NextResponse.json(
        {
          error: `Submitted to Meta but failed to save locally: ${upsertErr.message}. Run "Sync from Meta" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    const categoryChanged =
      metaCategory !== null && metaCategory !== payload.category

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
      ...(categoryChanged
        ? {
            category_changed: {
              requested: payload.category,
              assigned: metaCategory,
            },
          }
        : {}),
    })
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
