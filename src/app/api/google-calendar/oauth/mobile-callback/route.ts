import { NextResponse } from 'next/server';

import { GOOGLE_CALENDAR_MOBILE_RETURN } from '@/lib/google-calendar/oauth';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const query =
    code && state && !params.get('error')
      ? new URLSearchParams({ code, state })
      : new URLSearchParams({ error: 'consent_denied' });
  return NextResponse.redirect(
    `${GOOGLE_CALENDAR_MOBILE_RETURN}?${query.toString()}`
  );
}
