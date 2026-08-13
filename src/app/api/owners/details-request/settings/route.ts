import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  OWNER_DETAILS_SECTIONS,
  type OwnerDetailsSection,
} from '@/lib/owners/details-request';

// GET/PUT /api/owners/details-request/settings
//
// The account's own wording for the owner details request (migration
// 261). Every member reads it — the send dialog composes from it — and
// only an admin writes it, matching canEditSettings.
//
// Both fields are optional overrides: an empty `sections` and a null
// `body_template` mean "use the built-in message", which is what an
// account that never opens this panel gets forever.

/** Same ceiling the send route enforces, so a saved template cannot
 *  compose a message WhatsApp will refuse. */
const MAX_TEMPLATE_LENGTH = 4096;

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data, error } = await ctx.supabase
      .from('owner_details_request_settings')
      .select('sections, body_template, updated_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      data: {
        sections: (data?.sections as string[] | null) ?? [],
        body_template: (data?.body_template as string | null) ?? null,
        updated_at: (data?.updated_at as string | null) ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `owner-details-settings:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      sections?: unknown;
      body_template?: unknown;
    } | null;

    // Unknown section names are rejected rather than dropped: silently
    // saving a typo would leave the panel showing a selection the
    // message does not have.
    let sections: OwnerDetailsSection[] = [];
    if (body?.sections !== undefined && body.sections !== null) {
      if (!Array.isArray(body.sections)) {
        return NextResponse.json(
          { error: 'sections must be an array' },
          { status: 400 }
        );
      }
      const unknown = body.sections.filter(
        (s) => !OWNER_DETAILS_SECTIONS.includes(s as OwnerDetailsSection)
      );
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown section: ${String(unknown[0])}` },
          { status: 400 }
        );
      }
      // Stored in canonical order so the message numbers them the same
      // way however the panel happened to toggle them.
      sections = OWNER_DETAILS_SECTIONS.filter((s) =>
        (body.sections as string[]).includes(s)
      );
    }

    const raw = body?.body_template;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return NextResponse.json(
        { error: 'body_template must be text' },
        { status: 400 }
      );
    }
    const bodyTemplate =
      typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    if (bodyTemplate && bodyTemplate.length > MAX_TEMPLATE_LENGTH) {
      return NextResponse.json(
        {
          error: `The message must be ${MAX_TEMPLATE_LENGTH} characters or fewer`,
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('owner_details_request_settings')
      .upsert(
        {
          account_id: ctx.accountId,
          sections,
          body_template: bodyTemplate,
          updated_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      )
      .select('sections, body_template, updated_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
