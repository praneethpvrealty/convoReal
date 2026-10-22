import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { evaluateNudges } from '@/lib/copilot/nudges';
import { DEFAULT_LANGUAGE, isLanguageCode } from '@/lib/languages';

/**
 * GET /api/copilot/nudges?lang=hi — rule-based proactive tips (zero AI).
 * Called once per browser or app session by the nudge hooks; all
 * queries run on the caller's RLS-scoped client. `lang` picks the
 * copy's language and falls back to English for anything else.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();

    const limit = await checkRateLimit(
      `copilot-nudges:${ctx.accountId}`,
      RATE_LIMITS.copilotNudges
    );
    if (!limit.success) return rateLimitResponse(limit);

    const lang = request.nextUrl.searchParams.get('lang');
    const language = isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;
    const nudges = await evaluateNudges(ctx.supabase, ctx.accountId, language);
    return NextResponse.json({ nudges });
  } catch (err) {
    return toErrorResponse(err);
  }
}
