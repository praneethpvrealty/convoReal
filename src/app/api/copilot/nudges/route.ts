import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { evaluateNudges } from '@/lib/copilot/nudges';

/**
 * GET /api/copilot/nudges — rule-based proactive tips (zero AI).
 * Called once per browser session by useCopilotNudges; all queries
 * run on the caller's RLS-scoped client.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `copilot-nudges:${ctx.accountId}`,
      RATE_LIMITS.copilotNudges,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const nudges = await evaluateNudges(ctx.supabase, ctx.accountId);
    return NextResponse.json({ nudges });
  } catch (err) {
    return toErrorResponse(err);
  }
}
