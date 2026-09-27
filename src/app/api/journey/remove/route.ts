import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { deleteDealWithCleanup } from '@/lib/deals/delete-deal';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/journey/remove
// Body: { item_ids: string[] } or { mode: 'buyer' | 'property', subject_id: string }
//
// Removing a branch from the Journey removes the deal opened from it,
// with the same cleanup as DELETE /api/deals/[id]: a branch and its
// deal are one item, and a deal whose branch is gone would sit on the
// Board and in Records describing a pursuit the Journey no longer
// shows. Web and mobile both come through here, never deleting
// journey_items themselves, so a removal cannot leave the deal behind.

const MAX_ITEMS = 500;

type RemoveInput =
  | { kind: 'items'; itemIds: string[] }
  | { kind: 'subject'; mode: 'buyer' | 'property'; subjectId: string };

export function parseRemoveInput(
  raw: unknown
): { ok: true; value: RemoveInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object')
    return {
      ok: false,
      error: 'item_ids or a mode and subject_id are required',
    };
  const input = raw as Record<string, unknown>;
  if (Array.isArray(input.item_ids)) {
    const itemIds = [
      ...new Set(
        input.item_ids
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      ),
    ];
    if (itemIds.length === 0)
      return { ok: false, error: 'item_ids must name at least one item' };
    if (itemIds.length > MAX_ITEMS)
      return { ok: false, error: `At most ${MAX_ITEMS} items per call` };
    return { ok: true, value: { kind: 'items', itemIds } };
  }
  const mode =
    input.mode === 'property'
      ? 'property'
      : input.mode === 'buyer'
        ? 'buyer'
        : null;
  const subjectId =
    typeof input.subject_id === 'string' ? input.subject_id.trim() : '';
  if (!mode || !subjectId)
    return {
      ok: false,
      error: 'item_ids or a mode and subject_id are required',
    };
  return { ok: true, value: { kind: 'subject', mode, subjectId } };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:journeyRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseRemoveInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    let itemsQuery = ctx.supabase
      .from('journey_items')
      .select('id')
      .eq('account_id', ctx.accountId);
    itemsQuery =
      input.kind === 'items'
        ? itemsQuery.in('id', input.itemIds)
        : itemsQuery.eq(
            input.mode === 'buyer' ? 'contact_id' : 'property_id',
            input.subjectId
          );
    const { data: items, error: itemsErr } = await itemsQuery;
    if (itemsErr) throw itemsErr;
    const itemIds = (items ?? []).map((row) => row.id as string);
    if (itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Nothing was removed — reload and try again.' },
        { status: 404 }
      );
    }

    const { data: deals, error: dealsErr } = await ctx.supabase
      .from('deals')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in('source_journey_item_id', itemIds);
    if (dealsErr) throw dealsErr;
    const dealIds = (deals ?? []).map((row) => row.id as string);

    const { data: removed, error: removeErr } = await ctx.supabase
      .from('journey_items')
      .delete()
      .eq('account_id', ctx.accountId)
      .in('id', itemIds)
      .select('id');
    if (removeErr) throw removeErr;

    const failed: string[] = [];
    for (const dealId of dealIds) {
      const result = await deleteDealWithCleanup(ctx, dealId);
      if (!result.ok && result.status !== 404) failed.push(dealId);
    }

    return NextResponse.json({
      data: {
        items: (removed ?? []).length,
        deals: dealIds.length - failed.length,
        ...(failed.length > 0 ? { failed_deals: failed } : {}),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
