import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { parseConversionInput } from '@/lib/deals/conversion';
import { convertJourneyItemToDeal } from '@/lib/deals/convert-journey-item';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/journey/convert-to-deal — open the closing record for a
// journey item. Idempotent per item: a second call returns the deal
// that already exists rather than a duplicate.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:convertJourney:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseConversionInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await convertJourneyItemToDeal(ctx, parsed.value);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(
      { data: { id: result.id, existing: result.existing } },
      { status: result.status }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
