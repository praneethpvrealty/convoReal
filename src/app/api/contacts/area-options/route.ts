import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { groupAreaVariants } from '@/lib/contacts/area-variants';

// GET /api/contacts/area-options — every locality stored on the
// account's contacts, distinct-counted in SQL and grouped by spelling
// for the Contacts area filter on web and mobile.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc('contact_area_options', {
      p_account_id: ctx.accountId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (
      (data ?? []) as { area: string | null; n: number | string | null }[]
    )
      .filter((row) => typeof row.area === 'string')
      .map((row) => ({
        area: row.area as string,
        count: typeof row.n === 'number' ? row.n : Number(row.n ?? 0) || 0,
      }));

    return NextResponse.json({ data: groupAreaVariants(rows) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
