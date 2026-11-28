import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  loadMatchCounts,
  MATCH_COUNT_MAX_IDS,
  parseMatchCountIds,
} from '@/lib/inventory/match-counts';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const ids = parseMatchCountIds(
      new URL(request.url).searchParams.get('ids')
    );
    if (!ids) {
      return NextResponse.json(
        {
          error: `ids must be at most ${MATCH_COUNT_MAX_IDS} property ids`,
          code: 'INVALID_IDS',
        },
        { status: 400 }
      );
    }
    try {
      const data = await loadMatchCounts(ctx.supabase, ctx.accountId, ids, {
        role: ctx.role,
        userId: ctx.userId,
      });
      return NextResponse.json(
        { data },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    } catch (error) {
      console.error('[GET /api/properties/match-counts] Load error:', error);
      return NextResponse.json(
        { error: 'Failed to load match counts' },
        { status: 500 }
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
