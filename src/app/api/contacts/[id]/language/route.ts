import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isLanguageCode } from '@/lib/languages';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// PATCH /api/contacts/[id]/language — set the language this contact
// reads, or clear it back to "follow the account default".
//
// One column, like the favourite toggle: PUT /api/contacts/[id] is a
// full-record replace, so a one-tap chip on the contact record cannot
// go through it without wiping every field it does not carry.
//
// null is a real value here (migration 246): it means "not known",
// and the send path then inherits accounts.default_language. An
// explicit 'en' is the agent choosing English.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = await checkRateLimit(
      `agent:contactLanguage:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      preferred_language?: unknown;
    } | null;
    if (!body || !('preferred_language' in body)) {
      return NextResponse.json(
        { error: "'preferred_language' is required" },
        { status: 400 }
      );
    }
    const wanted = body.preferred_language;
    if (wanted !== null && !isLanguageCode(wanted)) {
      return NextResponse.json(
        {
          error:
            "'preferred_language' must be a supported language code or null",
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('contacts')
      .update({
        preferred_language: wanted,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .select('id, preferred_language')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/contacts/[id]/language] Update error:', error);
      return NextResponse.json(
        { error: error.message ?? 'Failed to update language' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
