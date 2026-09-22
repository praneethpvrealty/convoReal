import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { groupAreaVariants } from '@/lib/contacts/area-variants';

// GET /api/contacts/area-options — every locality stored on the
// account's contacts, grouped by spelling for the Contacts area filter
// on web and mobile. Two SQL passes: one per stored spelling (which
// spelling is the common one), then one per group counting distinct
// contacts, so a contact carrying two spellings is counted once.
const count = (value: number | string | null | undefined) =>
  typeof value === 'number' ? value : Number(value ?? 0) || 0;

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
      .map((row) => ({ area: row.area as string, count: count(row.n) }));

    const grouped = groupAreaVariants(rows);
    if (grouped.length === 0) {
      return NextResponse.json({ data: grouped });
    }

    const { data: counts, error: countError } = await ctx.supabase.rpc(
      'contact_area_group_counts',
      {
        p_account_id: ctx.accountId,
        p_groups: grouped.map((option) => ({
          key: option.key,
          variants: option.variants,
        })),
      }
    );
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    const byKey = new Map(
      ((counts ?? []) as { key: string; n: number | string | null }[]).map(
        (row) => [row.key, count(row.n)]
      )
    );

    return NextResponse.json({
      data: grouped.map((option) => ({
        ...option,
        count: byKey.get(option.key) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
