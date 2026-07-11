import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { recordFeedback } from '@/lib/copilot/qa-cache';

/**
 * POST /api/copilot/feedback — 👍/👎 on a cached helper answer.
 * The community signal that closes the self-learning loop: enough
 * downvotes and match_copilot_qa stops serving the entry.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `copilot-fb:${ctx.userId}`,
      RATE_LIMITS.copilotFeedback,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await req.json().catch(() => ({}))) as {
      cacheId?: unknown;
      vote?: unknown;
    };
    const cacheId = typeof body.cacheId === 'string' ? body.cacheId : '';
    const vote = body.vote === 'up' || body.vote === 'down' ? body.vote : null;
    if (!UUID_RE.test(cacheId) || !vote) {
      return NextResponse.json(
        { error: 'cacheId (uuid) and vote (up|down) required' },
        { status: 400 },
      );
    }

    const ok = await recordFeedback(cacheId, vote);
    return NextResponse.json({ ok });
  } catch (err) {
    return toErrorResponse(err);
  }
}
