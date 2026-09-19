import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { convertJourneyItemToDeal } from '@/lib/deals/convert-journey-item';
import { parseEventSource } from '@/lib/deals/events';
import {
  applyDealStageMove,
  parseBrokerageCapture,
} from '@/lib/deals/stage-move';
import { writeJourneyEvent } from '@/lib/journey/events';
import { parseJourneyMoveInput } from '@/lib/journey/move';
import {
  dealStatusForStage,
  needsBrokerageCapture,
} from '@/lib/pipelines/stage-semantics';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { JourneyStageKind } from '@/types';

// POST /api/journey/move — move a journey item to a stage. When the
// stage mirrors a pipeline stage, the item's deal follows through the
// same stage-move logic as the board (brokerage, closing record,
// property status), and a move into a closing or won stage opens the
// deal on that very stage.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:journeyMove:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsed = parseJourneyMoveInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { itemId, stageId, eventType } = parsed.value;
    const brokerage = parseBrokerageCapture(body as Record<string, unknown>);
    if (!brokerage.ok) {
      return NextResponse.json({ error: brokerage.error }, { status: 400 });
    }
    const source = parseEventSource(body.source);

    const [{ data: item }, { data: targetRow }] = await Promise.all([
      ctx.supabase
        .from('journey_items')
        .select('id, property_id, stage_id, property:properties(price)')
        .eq('id', itemId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('journey_stages')
        .select(
          'id, name, stage_kind, pipeline_stage_id, pipeline_stage:pipeline_stages(id, pipeline_id)'
        )
        .eq('id', stageId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    if (!item) {
      return NextResponse.json(
        { error: 'Journey item not found' },
        { status: 404 }
      );
    }
    if (!targetRow) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }
    const one = <T>(v: T | T[] | null | undefined): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    const target = {
      ...targetRow,
      stage_kind: targetRow.stage_kind as JourneyStageKind,
      pipeline_stage: one(targetRow.pipeline_stage),
    };
    const property = one(item.property);

    const { data: deal } = await ctx.supabase
      .from('deals')
      .select('id, value, brokerage_amount, property_id')
      .eq('account_id', ctx.accountId)
      .eq('source_journey_item_id', item.id)
      .maybeSingle();

    const opensRecord =
      target.stage_kind === 'closing' || target.stage_kind === 'won';
    const followsDeal =
      Boolean(target.pipeline_stage_id) && (Boolean(deal) || opensRecord);

    if (
      followsDeal &&
      !brokerage.value &&
      needsBrokerageCapture(deal ?? { brokerage_amount: null }, target.name)
    ) {
      return NextResponse.json(
        {
          error: `Record the brokerage before moving to ${target.name}`,
          code: 'BROKERAGE_REQUIRED',
          data: {
            stage_name: target.name,
            deal_value: Number(deal?.value ?? property?.price ?? 0) || 0,
          },
        },
        { status: 409 }
      );
    }

    const { data: moved, error: moveError } = await ctx.supabase
      .from('journey_items')
      .update({
        stage_id: target.id,
        status: 'active',
        drop_reason: null,
        dropped_at: null,
        planned_stage_id: null,
        planned_at: null,
      })
      .eq('id', item.id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (moveError || !moved?.length) {
      return NextResponse.json(
        { error: moveError?.message ?? 'That item is no longer there' },
        { status: moveError ? 500 : 404 }
      );
    }
    await writeJourneyEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      itemId: item.id,
      eventType,
      createdBy: ctx.userId,
      fromStageId: item.stage_id,
      toStageId: target.id,
    });

    let dealId: string | null = deal?.id ?? null;
    if (followsDeal && target.pipeline_stage_id) {
      if (deal) {
        const result = await applyDealStageMove(ctx, {
          dealId: deal.id,
          status: dealStatusForStage(target.name),
          targetStageId: target.pipeline_stage_id,
          stageName: target.name,
          propertyId: deal.property_id ?? item.property_id,
          brokerage: brokerage.value,
          source,
        });
        if (!result.ok) {
          return NextResponse.json(
            {
              error: `Journey moved but its deal did not follow: ${result.error}`,
              ...(result.code ? { code: result.code } : {}),
            },
            { status: result.status }
          );
        }
      } else {
        const result = await convertJourneyItemToDeal(ctx, {
          itemId: item.id,
          pipelineId: target.pipeline_stage?.pipeline_id ?? null,
          stageId: target.pipeline_stage_id,
          title: null,
          brokerage: brokerage.value,
          source,
        });
        if (!result.ok) {
          return NextResponse.json(
            {
              error: `Journey moved but its closing record did not open: ${result.error}`,
            },
            { status: result.status }
          );
        }
        dealId = result.id;
      }
    }

    return NextResponse.json({
      data: { item_id: item.id, stage_id: target.id, deal_id: dealId },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
