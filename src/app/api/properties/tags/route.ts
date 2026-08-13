import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

// GET /api/properties/tags
//
// The internal search tags this account already uses, most-used first.
// Both editors offer them as suggestions, so a project's listings end up
// carrying the same label instead of four spellings of it — a tag exists
// to be searched, and "APM" on three villas with "AMP" on the fourth
// makes the fourth invisible to the search it was added for.

export interface PropertyTagSuggestion {
  tag: string;
  uses: number;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc('account_property_tags', {
      target_account_id: ctx.accountId,
    });
    if (error) throw error;

    const tags: PropertyTagSuggestion[] = (
      (data ?? []) as Array<{ tag: string; uses: number }>
    ).map((row) => ({ tag: row.tag, uses: Number(row.uses) }));

    return NextResponse.json({ data: tags });
  } catch (err) {
    console.error('[GET /api/properties/tags] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
