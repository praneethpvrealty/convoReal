import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// PATCH /api/contacts/[id]/favorite — toggle the Favourites star.
//
// Deliberately not folded into PUT /api/contacts/[id]: that handler
// is a full-record replace (every field it doesn't receive is written
// back as null/[]), so a star toggle sent through it would wipe the
// contact. This touches one column.
//
// account_id is scoped explicitly even though ctx.supabase is the
// RLS-bound client — the filter is what makes a wrong id a no-op
// rather than relying on the policy alone.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = await checkRateLimit(
      `agent:favoriteContact:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      is_favorite?: unknown;
    } | null;
    const isFavorite = body?.is_favorite;

    if (typeof isFavorite !== 'boolean') {
      return NextResponse.json(
        { error: "'is_favorite' must be a boolean" },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('contacts')
      .update({ is_favorite: isFavorite, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .select('id, is_favorite')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/contacts/[id]/favorite] Update error:', error);
      return NextResponse.json(
        { error: error.message ?? 'Failed to update favourite' },
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
