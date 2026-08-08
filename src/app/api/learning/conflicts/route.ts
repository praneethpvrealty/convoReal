import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadConflicts } from '@/lib/learning/conflicts';

// GET /api/learning/conflicts?property_id=<uuid>
//
// Everything the Engine has learned or noticed that an agent has not
// ruled on: facts proposed from a conversation, and portal copies that
// disagree with our record. Scoped to one listing when property_id is
// given (the inventory detail panel), otherwise the account's queue.
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const propertyId = new URL(request.url).searchParams.get('property_id');

    return NextResponse.json({
      data: await loadConflicts(ctx.supabase, ctx.accountId, propertyId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
