import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { pairsWithin } from '@/lib/contacts/duplicate-dismissal';

// POST   /api/contacts/duplicates/dismiss  — "these are different people"
// DELETE /api/contacts/duplicates/dismiss  — undo that
// Body: { contactIds: string[] }
//
// Records the decision per pair rather than per group; see
// @/lib/contacts/duplicate-dismissal for why. Requires agent+.

async function readIds(request: NextRequest): Promise<string[] | null> {
  const body = (await request.json().catch(() => null)) as { contactIds?: unknown } | null;
  const ids = body?.contactIds;
  if (!Array.isArray(ids) || ids.length < 2) return null;
  if (!ids.every((id) => typeof id === 'string' && id.length > 0)) return null;
  return [...new Set(ids as string[])];
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const ids = await readIds(request);
    if (!ids) {
      return NextResponse.json(
        { error: 'contactIds must hold at least two contact ids' },
        { status: 400 },
      );
    }

    // Scoping the read to the account is what stops a caller dismissing a
    // pair from someone else's book; RLS covers the write, not the intent.
    const { data: owned, error: ownedErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in('id', ids);
    if (ownedErr) throw ownedErr;
    if ((owned?.length ?? 0) !== ids.length) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const rows = pairsWithin(ids).map(([a, b]) => ({
      account_id: ctx.accountId,
      contact_a_id: a,
      contact_b_id: b,
      dismissed_by: ctx.userId,
    }));

    const { error } = await ctx.supabase
      .from('contact_duplicate_dismissals')
      .upsert(rows, { onConflict: 'account_id,contact_a_id,contact_b_id' });
    if (error) throw error;

    return NextResponse.json({ data: { dismissed: rows.length } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const ids = await readIds(request);
    if (!ids) {
      return NextResponse.json(
        { error: 'contactIds must hold at least two contact ids' },
        { status: 400 },
      );
    }

    // One statement per pair: the pairs are few, and an `.in()` over a
    // composite key would have to be built by interpolating ids into a
    // filter string that travels in the URL.
    for (const [a, b] of pairsWithin(ids)) {
      const { error } = await ctx.supabase
        .from('contact_duplicate_dismissals')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('contact_a_id', a)
        .eq('contact_b_id', b);
      if (error) throw error;
    }

    return NextResponse.json({ data: { restored: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
