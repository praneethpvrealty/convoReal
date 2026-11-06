import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  REQUIREMENTS_LIST_LIMIT,
  REQUIREMENTS_TOTAL_HEADER,
} from '@/lib/requirements/list-limit';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const { data, error, count } = await ctx.supabase
      .from('contacts')
      .select(
        `
        *,
        contact_notes (*),
        conversations (id),
        contact_tags (
          id,
          tag_id,
          tags (*)
        )
      `,
        { count: 'exact' }
      )
      .eq('account_id', ctx.accountId)
      .in('classification', ['Buyer', 'Agent'])
      .order('created_at', { ascending: false })
      .range(0, REQUIREMENTS_LIST_LIMIT - 1);

    if (error) {
      console.error('[GET /api/requirements] DB select error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch requirements' },
        { status: 500 }
      );
    }

    const rows = data || [];
    return NextResponse.json(rows, {
      headers: { [REQUIREMENTS_TOTAL_HEADER]: String(count ?? rows.length) },
    });
  } catch (err) {
    console.error('[GET /api/requirements] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
