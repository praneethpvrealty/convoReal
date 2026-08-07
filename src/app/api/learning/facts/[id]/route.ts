import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fieldPolicy, type LearnedEntity } from '@/lib/learning/fields';

const TABLE: Record<LearnedEntity, string> = {
  property: 'properties',
  contact: 'contacts',
};

// PATCH /api/learning/facts/[id]  { action: 'approve' | 'reject' }
//
// Approving is what writes a proposed fact onto the record — the
// learner only ever proposed it. Rejecting closes the item and leaves
// the record untouched. The row survives either way as the record of
// what was proposed, from which message, and what was decided.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: "'action' must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    const { data: fact, error: loadErr } = await ctx.supabase
      .from('learned_facts')
      .select('id, entity_type, entity_id, field, value, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (loadErr) {
      console.error('[PATCH /api/learning/facts] load error:', loadErr);
      return NextResponse.json({ error: 'Failed to load fact' }, { status: 500 });
    }
    if (!fact) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 });
    }
    if (fact.status !== 'pending') {
      return NextResponse.json(
        { error: 'This has already been reviewed' },
        { status: 409 }
      );
    }

    // The registry is the write whitelist, re-checked here so a field
    // retired since the row was written cannot reach a column through
    // an old queue item.
    const policy = fieldPolicy(fact.entity_type as LearnedEntity, fact.field);
    if (!policy) {
      return NextResponse.json(
        { error: 'This fact targets a field the Engine no longer writes' },
        { status: 400 }
      );
    }

    if (action === 'approve') {
      const patch: Record<string, unknown> = { [policy.column]: fact.value };
      if (policy.entity === 'property' && policy.field.startsWith('seller_final_price')) {
        patch.seller_final_price_at = new Date().toISOString();
        patch.seller_final_price_source = 'chat';
      }

      // .select() because an RLS refusal returns zero rows and no
      // error: without it a refused write would close the item as
      // applied and the fact would vanish.
      const { data: applied, error: applyErr } = await ctx.supabase
        .from(TABLE[policy.entity])
        .update(patch)
        .eq('id', fact.entity_id)
        .eq('account_id', ctx.accountId)
        .select('id');

      if (applyErr || !applied?.length) {
        console.error('[PATCH /api/learning/facts] apply error:', applyErr);
        return NextResponse.json(
          { error: 'Failed to apply this to the record' },
          { status: 500 }
        );
      }
    }

    // Only after the record write succeeded — an item marked approved
    // against a record that never took the value would read as done and
    // never be shown again.
    const { data: closed, error: closeErr } = await ctx.supabase
      .from('learned_facts')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');

    if (closeErr || !closed?.length) {
      console.error('[PATCH /api/learning/facts] close error:', closeErr);
      return NextResponse.json(
        { error: 'Failed to record the decision' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id, status: action === 'approve' ? 'approved' : 'rejected' },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
