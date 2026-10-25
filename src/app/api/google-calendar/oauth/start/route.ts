import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { GOOGLE_CALENDAR_SCOPES } from '@/lib/google-calendar/client';
import {
  GOOGLE_CALENDAR_COOKIE_PATH,
  GOOGLE_CALENDAR_NONCE_COOKIE,
  googleCalendarRedirectUri,
  googleOAuthCredentials,
} from '@/lib/google-calendar/oauth';
import { generateNonce, signOAuthState } from '@/lib/meta-ads/oauth-state';
import { buildAuthUrl } from '@/lib/youtube/client';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer');
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
      client?: unknown;
    };
    const client = body.client === 'mobile' ? 'mobile' : 'web';
    const nonce = generateNonce();
    const state = signOAuthState(
      {
        accountId: ctx.accountId,
        userId: ctx.userId,
        client,
        nonce,
        ts: Date.now(),
      },
      credentials.clientSecret
    );

    if (client === 'web') {
      const cookieStore = await cookies();
      cookieStore.set(GOOGLE_CALENDAR_NONCE_COOKIE, nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60,
        path: GOOGLE_CALENDAR_COOKIE_PATH,
      });
    }

    return NextResponse.json({
      data: {
        url: buildAuthUrl({
          clientId: credentials.clientId,
          redirectUri: googleCalendarRedirectUri(client),
          state,
          scope: GOOGLE_CALENDAR_SCOPES,
          includeGrantedScopes: false,
        }),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
