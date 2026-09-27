import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { setListingStatusFromDeal } from '@/lib/inventory/listing-status-sync';
import { parseJourneyStatusInput } from '@/lib/journey/status';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/journey/status — drop or reactivate a journey branch. The
// branch's deal follows through the journey trigger, and every listing
// with a deal on the branch is re-synced so it is released, and its
// enquirers told, once no deal holds it.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:journeyStatus:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseJourneyStatusInput(
      await request.json().catch(() => null)
    );
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { itemId, action, reason } = parsed.value;

    const { data: updated, error: updateError } = await ctx.supabase
      .from('journey_items')
      .update(
        action === 'drop'
          ? {
              status: 'dropped',
              drop_reason: reason,
              dropped_at: new Date().toISOString(),
            }
          : { status: 'active', drop_reason: null, dropped_at: null }
      )
      .eq('id', itemId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (!updated?.length) {
      return NextResponse.json(
        { error: 'That item is no longer there' },
        { status: 404 }
      );
    }

    const { data: deals, error: dealsError } = await ctx.supabase
      .from('deals')
      .select('property_id')
      .eq('account_id', ctx.accountId)
      .eq('source_journey_item_id', itemId)
      .not('property_id', 'is', null);
    const propertyIds = [
      ...new Set(
        ((deals ?? []) as { property_id: string | null }[])
          .map((deal) => deal.property_id)
          .filter((id): id is string => !!id)
      ),
    ];
    let synced = !dealsError;
    for (const propertyId of propertyIds) {
      synced =
        (await setListingStatusFromDeal(
          ctx.supabase,
          ctx.accountId,
          propertyId,
          'Available'
        )) && synced;
    }
    if (!synced) {
      return NextResponse.json(
        {
          error:
            'The branch was updated, but the status of its listing could not be updated. Check it in Inventory.',
          code: 'LISTING_SYNC_FAILED',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { item_id: itemId } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
