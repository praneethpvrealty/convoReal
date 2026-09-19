import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { parseEventSource } from '@/lib/deals/events';
import { parseBrokerageCapture } from '@/lib/deals/stage-move';
import { moveJourneyItem, parseJourneyMoveInput } from '@/lib/journey/move';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

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
    const brokerage = parseBrokerageCapture(body as Record<string, unknown>);
    if (!brokerage.ok) {
      return NextResponse.json({ error: brokerage.error }, { status: 400 });
    }

    const result = await moveJourneyItem(ctx, {
      ...parsed.value,
      brokerage: brokerage.value,
      requireBrokerage: true,
      source: parseEventSource(body.source),
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.code ? { code: result.code } : {}),
          ...(result.data ? { data: result.data } : {}),
        },
        { status: result.status }
      );
    }
    return NextResponse.json({
      data: {
        item_id: result.itemId,
        stage_id: result.stageId,
        deal_id: result.dealId,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
