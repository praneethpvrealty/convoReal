import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_PINNED_IDS = 500;
const MAX_PINNED_ID_LENGTH = 64;

// POST /api/showcase-shares  { ids?: string[] }
// Mints a share-instance token for the showcase link. The client
// appends it as ?s=<id>; the public beacon stamps matching events with
// it so Pulse can attribute anonymous visits to "the link you shared
// <when>" (migration 173). A search-results or hand-picked share also
// records the listings it opens here, so the link carries the token
// instead of every property code. Callers treat minting as
// best-effort — a failed mint falls back to the plain link, never a
// blocked share.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `showcase-shares:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
    } | null;
    const pinnedIds = parsePinnedIds(body?.ids);
    if (pinnedIds === null) {
      return NextResponse.json(
        { error: `ids must be up to ${MAX_PINNED_IDS} property codes` },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('showcase_share_links')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        pinned_ids: pinnedIds.length > 0 ? pinnedIds : null,
      })
      .select('id')
      .single();
    if (error) throw error;

    return NextResponse.json({ data: { id: data.id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function parsePinnedIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PINNED_IDS) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const id = entry.trim();
    if (!id || id.length > MAX_PINNED_ID_LENGTH || id.includes(','))
      return null;
    ids.push(id);
  }
  return ids;
}
