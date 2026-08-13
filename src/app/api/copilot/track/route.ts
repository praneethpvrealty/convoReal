// ============================================================
// POST /api/copilot/track — tour usage beacon.
//
// Chat answers and support tickets are metered where they happen
// server-side, but guided tours run entirely on the client — a tour
// started from the Guides list would be invisible without this. The
// web widget and the Expo app both fire it on tour_start and
// tour_complete; unknown tour ids are dropped, not stored.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { logCopilotEvent } from '@/lib/copilot/events';
import { parsePlatform } from '@/lib/copilot/platform';
import { getTour } from '@/lib/copilot/tours';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = await checkRateLimit(
      `copilot-track:${ctx.userId}`,
      RATE_LIMITS.copilotFeedback
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      event?: unknown;
      tourId?: unknown;
      platform?: unknown;
    };

    const event =
      body.event === 'tour_start' || body.event === 'tour_complete'
        ? body.event
        : null;
    const tourId =
      typeof body.tourId === 'string' && getTour(body.tourId)
        ? body.tourId
        : null;
    if (!event || !tourId) {
      return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
    }

    logCopilotEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      platform: parsePlatform(body.platform),
      event,
      tourId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
