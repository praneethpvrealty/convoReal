import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

import { requireRole } from '@/lib/auth/account';
import {
  GOOGLE_CALENDAR_COOKIE_PATH,
  GOOGLE_CALENDAR_NONCE_COOKIE,
  GoogleConnectError,
  appBaseUrl,
  completeGoogleCalendarConnection,
  googleOAuthCredentials,
} from '@/lib/google-calendar/oauth';
import { verifyOAuthState } from '@/lib/meta-ads/oauth-state';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

function calendarUrl(params: Record<string, string>): string {
  const url = new URL('/calendar', appBaseUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const done = (url: string) => {
    const res = NextResponse.redirect(url);
    res.cookies.set(GOOGLE_CALENDAR_NONCE_COOKIE, '', {
      maxAge: 0,
      path: GOOGLE_CALENDAR_COOKIE_PATH,
    });
    return res;
  };

  const params = new URL(request.url).searchParams;
  const state = params.get('state');
  const code = params.get('code');
  const credentials = googleOAuthCredentials();
  if (!credentials) {
    return done(calendarUrl({ google_calendar_error: 'not_configured' }));
  }

  if (params.get('error') || !code) {
    return done(calendarUrl({ google_calendar_error: 'consent_denied' }));
  }

  const nonce = cookieStore.get(GOOGLE_CALENDAR_NONCE_COOKIE)?.value;
  if (!nonce) {
    return done(calendarUrl({ google_calendar_error: 'state_bad_signature' }));
  }
  const verified = verifyOAuthState(state, credentials.clientSecret, nonce);
  if (!verified.valid) {
    return done(
      calendarUrl({ google_calendar_error: `state_${verified.reason}` })
    );
  }
  const { payload } = verified;

  try {
    const ctx = await requireRole('viewer');
    if (ctx.accountId !== payload.accountId || ctx.userId !== payload.userId) {
      return done(calendarUrl({ google_calendar_error: 'account_mismatch' }));
    }
    await completeGoogleCalendarConnection(supabaseAdmin(), {
      code,
      accountId: ctx.accountId,
      userId: ctx.userId,
      client: 'web',
    });
    return done(calendarUrl({ google_calendar: 'connected' }));
  } catch (err) {
    console.error('[google-calendar oauth callback] failed:', err);
    return done(
      calendarUrl({
        google_calendar_error:
          err instanceof GoogleConnectError ? err.code : 'connection_failed',
      })
    );
  }
}
