// ============================================================
// PATCH /api/whatsapp/templates/draft/[id]
//
// Edit the wording of a local draft, without going near Meta.
//
// This closes a hole the translation gate opened. A translated draft
// had exactly one control — Submit — and the gate refuses to submit
// anything unreviewed, while PATCH /templates/[id] refuses any row
// without a meta_template_id. So the review card said "edit it if it
// reads wrong" and there was no way to do that. A reviewer could
// approve the machine's wording or nothing.
//
// Kept separate from PATCH /templates/[id] on purpose: that route's
// whole job is the Meta round-trip (edit there re-opens review and
// can bounce off the fixed-category rule). Overloading it with a
// local-only mode would blur a contract worth keeping sharp.
//
// Body and footer only — see the note on buttons below.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators';
import type { TemplateButton } from '@/types';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `{{1}}`-style placeholders, deduplicated and sorted. */
function placeholders(text: string): string {
  return [...new Set(text.match(/\{\{\d+\}\}/g) ?? [])].sort().join(',');
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx: AccountContext;
  try {
    ctx = await requireOrgRole('org_manager');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { supabase, userId, accountId } = ctx;

  try {
    const limit = checkRateLimit(
      `admin:templateDraftEdit:${userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | { body_text?: unknown; footer_text?: unknown }
      | null;
    if (!body || typeof body.body_text !== 'string') {
      return NextResponse.json(
        { error: "'body_text' is required" },
        { status: 400 },
      );
    }
    const nextBody = body.body_text;
    const nextFooter =
      typeof body.footer_text === 'string' ? body.footer_text.trim() || null : null;

    const { data: existing, error: loadErr } = await supabase
      .from('message_templates')
      .select(
        'id, name, category, language, header_type, header_content, header_media_url, body_text, footer_text, buttons, sample_values, meta_template_id',
      )
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (loadErr) {
      console.error('[PATCH templates/draft] load error:', loadErr);
      return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (existing.meta_template_id) {
      return NextResponse.json(
        {
          error:
            'This template already exists on Meta — edit it from the template list, which re-opens Meta review.',
          code: 'ALREADY_ON_META',
        },
        { status: 409 },
      );
    }

    // Placeholders are the contract with the send path: the params it
    // passes are positional, so dropping or adding one makes every
    // future send fail on a count mismatch — long after the edit, and
    // nowhere near it. Reordering within the sentence is fine and
    // often necessary for Indic grammar; changing the SET is not.
    if (placeholders(nextBody) !== placeholders(existing.body_text as string)) {
      return NextResponse.json(
        {
          error:
            'The {{1}}, {{2}} … placeholders must stay exactly as they were. You can move one within the sentence, but not add, remove or renumber them.',
          code: 'PLACEHOLDERS_CHANGED',
        },
        { status: 400 },
      );
    }

    // Validate as a whole template rather than as a loose string, so an
    // edit is held to precisely what a submit would be held to: length,
    // no leading/trailing placeholder, no two placeholders adjacent,
    // enough static words for Meta's density check. A reviewer finds
    // out here, while the wording is in front of them — not at submit.
    const payload: TemplatePayload = {
      name: existing.name as string,
      category: existing.category as TemplatePayload['category'],
      language: existing.language as string,
      header_type: (existing.header_type ?? undefined) as TemplatePayload['header_type'],
      header_content: (existing.header_content ?? undefined) as string | undefined,
      header_media_url: (existing.header_media_url ?? undefined) as string | undefined,
      body_text: nextBody,
      footer_text: nextFooter ?? undefined,
      buttons: (existing.buttons ?? undefined) as TemplateButton[] | undefined,
      sample_values: (existing.sample_values ?? undefined) as TemplatePayload['sample_values'],
    };
    try {
      validateTemplatePayload(payload);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      );
    }

    // .select() is load-bearing: an RLS refusal comes back as zero rows
    // and no error, so without it a refused write reads as a save and
    // the reviewer's correction silently vanishes on reload.
    //
    // translation_reviewed_at is deliberately not touched here — the
    // trigger from migration 248 clears it whenever the body changes,
    // which is the behaviour we want: corrected wording has not been
    // signed off yet, even by the person who just corrected it.
    const { data, error } = await supabase
      .from('message_templates')
      .update({ body_text: nextBody, footer_text: nextFooter })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, body_text, footer_text, translation_reviewed_at');

    if (error) {
      console.error('[PATCH templates/draft] update error:', error);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ data: data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
