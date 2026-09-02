import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { buildDuplicateListingInsert } from '@/lib/inventory/duplicate-listing';

// POST /api/properties/[id]/duplicate
// Copies an existing listing's details into a new draft — same society,
// next unit. Photos, documents, video and the original's engagement
// history stay with the original.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Property ID is required' },
        { status: 400 }
      );
    }

    const limit = await checkRateLimit(
      `agent:duplicateProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const gate = await checkPlanLimit(ctx, 'properties');
    if (!gate.allowed) return gateResponse(gate);

    const { data: source, error: sourceError } = await ctx.supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (sourceError) {
      console.error(
        '[POST /api/properties/[id]/duplicate] Select error:',
        sourceError
      );
      return NextResponse.json(
        { error: 'Failed to fetch property' },
        { status: 500 }
      );
    }

    if (!source) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const insertData = buildDuplicateListingInsert(source, {
      accountId: ctx.accountId,
      userId: ctx.userId,
    });

    const { data: created, error: insertError } = await ctx.supabase
      .from('properties')
      .insert(insertData)
      .select(
        '*, owner:contacts!properties_owner_contact_id_fkey(name, phone, classification, name_tag)'
      )
      .single();

    if (insertError || !created) {
      console.error(
        '[POST /api/properties/[id]/duplicate] Insert error:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to duplicate property' },
        { status: 500 }
      );
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
