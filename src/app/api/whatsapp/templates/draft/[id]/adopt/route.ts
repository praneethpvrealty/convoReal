// ============================================================
// POST /api/whatsapp/templates/draft/[id]/adopt
//
// Replace a local draft's wording with the copy ConvoReal ships today.
//
// The other half of migration 252. The column makes "this account's
// copy has fallen behind ours" visible; this is what a person can
// actually do about it, and it is a person's choice by design — the
// server never rewrites an account's template on its own, because a
// row that reads as behind may be a deliberate rewording nobody wants
// undone.
//
// Local drafts only. Adopting on a row Meta already holds means
// re-opening review, and a rejected edit can take the whole template
// with it, so that path goes through the ordinary Meta edit dialog
// where the consequence is stated. Refused here with a code the UI
// uses to route the user there instead.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account';
import { languageForMetaCode } from '@/lib/languages';
import { engineCopyKey } from '@/lib/whatsapp/engine-templates';
import { copyRevision } from '@/lib/whatsapp/template-copy';
import { shippedCopy } from '@/lib/whatsapp/template-drift';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
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
      `admin:templateAdopt:${userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }

    const { data: existing, error: loadErr } = await supabase
      .from('message_templates')
      .select('id, name, language, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (loadErr) {
      console.error('[POST templates/draft/adopt] load error:', loadErr);
      return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (existing.meta_template_id) {
      return NextResponse.json(
        {
          error:
            'This template already exists on Meta. Use Edit to take the new wording — that re-opens Meta review, and the template keeps sending its current copy until the review clears.',
          code: 'ALREADY_ON_META',
        },
        { status: 409 },
      );
    }

    const key = engineCopyKey(existing.name as string);
    const language = languageForMetaCode((existing.language as string) ?? 'en_US');
    if (!key || !language) {
      return NextResponse.json(
        {
          error: 'There is no ConvoReal wording behind this template to take.',
          code: 'NOT_ENGINE_TEMPLATE',
        },
        { status: 400 },
      );
    }

    const copy = shippedCopy(key, language);

    // .select() is load-bearing: an RLS refusal comes back as zero rows
    // and no error, so without it a refused write reads as a save.
    //
    // translation_reviewed_at is left to the migration-248 trigger,
    // which clears it because the body changed. That is right even
    // though the new wording is ours: it is wording this account's
    // reader has never seen, and the whole gate exists so nobody's
    // client is the first person to read it.
    const { data, error } = await supabase
      .from('message_templates')
      .update({
        body_text: copy.body_text,
        footer_text: copy.footer_text,
        copy_revision: copyRevision(key, language),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, body_text, footer_text, copy_revision, translation_reviewed_at');

    if (error) {
      console.error('[POST templates/draft/adopt] update error:', error);
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
