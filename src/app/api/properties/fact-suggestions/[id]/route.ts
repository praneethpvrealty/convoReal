import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { SUGGESTABLE_PROPERTY_FIELDS } from '@/types';

// PATCH /api/properties/fact-suggestions/[id]  { action: 'approve' | 'reject' }
//
// Approving is what writes the learned fact onto the listing — the
// extraction only ever proposed it. Rejecting closes the suggestion and
// leaves the property untouched; the row survives either way as the
// record of what was proposed and what was decided.
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

    const { data: suggestion, error: loadErr } = await ctx.supabase
      .from('property_fact_suggestions')
      .select('id, property_id, field, suggested_value, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (loadErr) {
      console.error(
        '[PATCH /api/properties/fact-suggestions] load error:',
        loadErr
      );
      return NextResponse.json(
        { error: 'Failed to load suggestion' },
        { status: 500 }
      );
    }
    if (!suggestion) {
      return NextResponse.json(
        { error: 'Suggestion not found' },
        { status: 404 }
      );
    }
    if (suggestion.status !== 'pending') {
      return NextResponse.json(
        { error: 'This suggestion has already been reviewed' },
        { status: 409 }
      );
    }

    // The CHECK constraint enforces this too; re-asserting it here keeps
    // an unexpected value out of a dynamically-keyed update object.
    if (
      !(SUGGESTABLE_PROPERTY_FIELDS as readonly string[]).includes(
        suggestion.field
      )
    ) {
      return NextResponse.json(
        { error: 'Suggestion targets an unknown field' },
        { status: 400 }
      );
    }

    if (action === 'approve') {
      // .select() is not decoration: an RLS refusal returns zero rows and
      // no error, so without it a refused write would close the
      // suggestion as applied and the fact would vanish.
      const { data: applied, error: applyErr } = await ctx.supabase
        .from('properties')
        .update({
          [suggestion.field]: suggestion.suggested_value,
          seller_final_price_at: new Date().toISOString(),
          seller_final_price_source: 'chat',
        })
        .eq('id', suggestion.property_id)
        .eq('account_id', ctx.accountId)
        .select('id');

      if (applyErr || !applied?.length) {
        console.error(
          '[PATCH /api/properties/fact-suggestions] apply error:',
          applyErr
        );
        return NextResponse.json(
          { error: 'Failed to apply the suggestion to the listing' },
          { status: 500 }
        );
      }
    }

    // Only after the listing write succeeded — a suggestion marked
    // approved against a property that never took the value would read
    // as done and never be shown again.
    const { data: closed, error: closeErr } = await ctx.supabase
      .from('property_fact_suggestions')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');

    if (closeErr || !closed?.length) {
      console.error(
        '[PATCH /api/properties/fact-suggestions] close error:',
        closeErr
      );
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
