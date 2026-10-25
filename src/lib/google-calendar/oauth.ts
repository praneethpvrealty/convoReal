import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getGoogleEmail } from '@/lib/google-calendar/client';
import {
  CONNECTION_COLUMNS,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from '@/lib/google-calendar/sync';
import { encrypt } from '@/lib/whatsapp/encryption';
import { exchangeCodeForTokens } from '@/lib/youtube/client';

export const GOOGLE_CALENDAR_NONCE_COOKIE = 'google_calendar_oauth_nonce';
export const GOOGLE_CALENDAR_COOKIE_PATH = '/api/google-calendar/oauth';
export const GOOGLE_CALENDAR_MOBILE_RETURN = 'convoreal://google-calendar';

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export type GoogleCalendarClient = 'web' | 'mobile';

export function googleCalendarRedirectUri(
  client: GoogleCalendarClient = 'web'
): string {
  return client === 'mobile'
    ? `${appBaseUrl()}/api/google-calendar/oauth/mobile-callback`
    : `${appBaseUrl()}/api/google-calendar/oauth/callback`;
}

export function googleOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export class GoogleConnectError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleConnectError';
    this.code = code;
  }
}

export async function completeGoogleCalendarConnection(
  admin: SupabaseClient,
  opts: {
    code: string;
    accountId: string;
    userId: string;
    client: GoogleCalendarClient;
  }
): Promise<{ googleEmail: string | null }> {
  const credentials = googleOAuthCredentials();
  if (!credentials) {
    throw new GoogleConnectError(
      'not_configured',
      'Google Calendar is not configured on this server.'
    );
  }
  const tokens = await exchangeCodeForTokens({
    code: opts.code,
    redirectUri: googleCalendarRedirectUri(opts.client),
    ...credentials,
  });
  if (!tokens.refresh_token) {
    throw new GoogleConnectError(
      'no_refresh_token',
      'Google did not grant offline access. Try connecting again.'
    );
  }
  if (
    !tokens.scope
      ?.split(' ')
      .includes('https://www.googleapis.com/auth/calendar.app.created')
  ) {
    throw new GoogleConnectError(
      'scope_denied',
      'Allow ConvoReal to manage its own calendar to turn on syncing.'
    );
  }
  const googleEmail = await getGoogleEmail(tokens.access_token).catch(
    () => null
  );

  const { data: existing, error: existingError } = await admin
    .from('google_calendar_connections')
    .select('account_id, google_email, calendar_id')
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (existingError) throw existingError;
  const keepCalendar =
    !!existing?.calendar_id &&
    !!googleEmail &&
    existing.google_email === googleEmail &&
    existing.account_id === opts.accountId;

  const { data, error } = await admin
    .from('google_calendar_connections')
    .upsert(
      {
        account_id: opts.accountId,
        user_id: opts.userId,
        refresh_token: encrypt(tokens.refresh_token),
        google_email: googleEmail,
        calendar_id: keepCalendar ? existing.calendar_id : null,
        status: 'connected',
        last_error: null,
        last_synced_at: null,
      },
      { onConflict: 'user_id' }
    )
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;

  after(async () => {
    await syncGoogleCalendar(
      admin,
      data as GoogleCalendarConnection,
      appBaseUrl()
    );
  });
  return { googleEmail };
}
