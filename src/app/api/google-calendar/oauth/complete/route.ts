import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  GoogleConnectError,
  completeGoogleCalendarConnection,
  googleOAuthCredentials,
} from '@/lib/google-calendar/oauth';
import { verifyOAuthState } from '@/lib/meta-ads/oauth-state';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('viewer');
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = await checkRateLimit(
    `googleCalendarConnect:${ctx.userId}`,
    RATE_LIMITS.adminAction
  );
  if (!limit.success) return rateLimitResponse(limit);

  const credentials = googleOAuthCredentials();
  if (!credentials) {
    return NextResponse.json(
      {
        error: 'Google Calendar is not configured on this server.',
        code: 'not_configured',
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    state?: unknown;
  };
  if (typeof body.code !== 'string' || typeof body.state !== 'string') {
    return NextResponse.json(
      { error: 'code and state are required' },
      { status: 400 }
    );
  }

  const verified = verifyOAuthState(body.state, credentials.clientSecret);
  if (
    !verified.valid ||
    verified.payload.client !== 'mobile' ||
    verified.payload.userId !== ctx.userId ||
    verified.payload.accountId !== ctx.accountId
  ) {
    return NextResponse.json(
      {
        error: 'This sign-in link is not valid for your account. Try again.',
        code: 'state_mismatch',
      },
      { status: 400 }
    );
  }

  try {
    const { googleEmail } = await completeGoogleCalendarConnection(
      supabaseAdmin(),
      { code: body.code, accountId: ctx.accountId, userId: ctx.userId }
    );
    return NextResponse.json({ data: { google_email: googleEmail } });
  } catch (err) {
    console.error('[POST /api/google-calendar/oauth/complete]', err);
    if (err instanceof GoogleConnectError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Could not connect Google Calendar. Try again.' },
      { status: 502 }
    );
  }
}
