import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * Closing a gap.
 *
 * 'resolved' means the work was done; 'dismissed' means it was never a
 * gap. The distinction is kept because they mean opposite things about
 * the detector that raised it, and collapsing them would throw away the
 * only signal available for whether this thing is worth raising at all.
 *
 * Rows are never deleted — closing is an UPDATE, so what was raised and
 * what was decided stays auditable, and the partial unique index on
 * (account_id, dedupe_key) WHERE status = 'open' frees the key so a
 * genuinely recurring problem can be raised again.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const { id } = await context.params;

    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
    };
    const status = body.status;
    if (status !== 'resolved' && status !== 'dismissed') {
      return NextResponse.json(
        { error: "status must be 'resolved' or 'dismissed'" },
        { status: 400 }
      );
    }

    // .select() because an RLS refusal returns zero rows and no error:
    // without it a refused close would be reported as a success and the
    // gap would still be sitting there on the next screen.
    const { data, error } = await supabase
      .from('conversation_gaps')
      .update({
        status,
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('status', 'open')
      .select('id, status')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Gap not found or already closed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
