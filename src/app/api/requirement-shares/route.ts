import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requirementReference } from '@/lib/requirements/share';
import {
  mintRequirementLinkToken,
  requirementLinkPath,
  requirementLinkTtlMs,
} from '@/lib/requirements/share-links';

// POST /api/requirement-shares
// Mints an interactive share link for one requirement (migration 210).
// The client appends /req/<token> to the co-broker message; the public
// page reveals the brief at the mode frozen here and takes matching
// listings back through the /list funnel or the engine WhatsApp.
// Callers treat minting as best-effort — a failed mint falls back to
// the plain text digest, never a blocked share.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `requirement-shares:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: string;
      mode?: string;
      expires_in?: string;
    } | null;

    const contactId = body?.contact_id;
    const mode = body?.mode === 'full' ? 'full' : 'masked';

    if (!contactId || !UUID_RE.test(contactId)) {
      return NextResponse.json({ error: 'Invalid contact' }, { status: 400 });
    }

    // RLS-scoped read — proves the requirement belongs to this account
    // before a public credential for it exists.
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, requirement_active')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (contact.requirement_active === false) {
      return NextResponse.json(
        { error: 'This requirement is parked', code: 'REQUIREMENT_PARKED' },
        { status: 409 }
      );
    }

    const { token, expiresAt } = mintRequirementLinkToken(
      requirementLinkTtlMs(body?.expires_in)
    );

    const { data, error } = await ctx.supabase
      .from('requirement_share_links')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        created_by: ctx.userId,
        token,
        mode,
        expires_at: expiresAt,
      })
      .select('id, token')
      .single();
    if (error) throw error;

    return NextResponse.json({
      data: {
        id: data.id,
        token: data.token,
        path: requirementLinkPath(data.token),
        reference: requirementReference(contactId),
        expires_at: expiresAt,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
