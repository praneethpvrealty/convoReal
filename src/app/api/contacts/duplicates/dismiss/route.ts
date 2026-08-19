import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { pairsWithin } from '@/lib/contacts/duplicate-dismissal';

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type FriendlySupabaseError = {
  message: string;
  status: number;
};

function toFriendlyError(err: unknown): FriendlySupabaseError | null {
  if (typeof err !== 'object' || err === null) return null;
  const typed = err as SupabaseError;
  if (!typed.code) return null;

  if (typed.code === '23505') {
    return {
      message: 'This pair was already marked as not duplicates.',
      status: 200,
    };
  }

  if (typed.code === '23514') {
    return {
      message: 'Could not save the duplicate decision. Please retry.',
      status: 400,
    };
  }

  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const normalised = [];
  for (const id of ids) {
    if (typeof id !== 'string') return null;
    const trimmed = id.trim();
    if (!UUID_RE.test(trimmed)) return null;
    normalised.push(trimmed);
  }
  return [...new Set(normalised)];
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
    if (error) {
      const friendly = toFriendlyError(error);
      if (friendly) {
        if (friendly.status === 200) {
          return NextResponse.json({ data: { dismissed: rows.length } });
        }
        return NextResponse.json({ error: friendly.message }, { status: friendly.status });
      }
      throw error;
    }

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
        // Restoring a pair that was never dismissed deletes nothing,
        // which is the normal path across a set of ids rather than a
        // refusal — the end state is what the caller asked for.
        // eslint-disable-next-line convoreal/supabase-write-guard
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('contact_a_id', a)
        .eq('contact_b_id', b);
      if (error) {
        const friendly = toFriendlyError(error);
        if (friendly) {
          if (friendly.status === 200) {
            continue;
          }
          return NextResponse.json({ error: friendly.message }, { status: friendly.status });
        }
        throw error;
      }
    }

    return NextResponse.json({ data: { restored: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
