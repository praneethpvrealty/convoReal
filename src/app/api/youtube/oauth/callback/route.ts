import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { verifyOAuthState } from '@/lib/meta-ads/oauth-state';
import { exchangeCodeForTokens, getMyChannel } from '@/lib/youtube/client';

const NONCE_COOKIE = 'youtube_oauth_nonce';

function settingsUrl(base: string, params: Record<string, string>): string {
  const url = new URL('/settings', base);
  url.searchParams.set('tab', 'showcase');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function oauthRedirectUri(appBase: string): string {
  return `${appBase.replace(/\/$/, '')}/api/youtube/oauth/callback`;
}

// GET /api/youtube/oauth/callback
// Google redirects the browser here after the consent dialog. Always
// redirects back to Settings → Showcase (success or error) — never
// returns raw JSON, since the caller is a browser navigation.
export async function GET(request: NextRequest) {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000';
  const cookieStore = await cookies();

  const clearNonceCookie = (res: NextResponse) => {
    res.cookies.set(NONCE_COOKIE, '', {
      maxAge: 0,
      path: '/api/youtube/oauth',
    });
    return res;
  };

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('error')) {
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'consent_denied' })
        )
      );
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!code || !clientId || !clientSecret) {
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'invalid_request' })
        )
      );
    }

    const nonce = cookieStore.get(NONCE_COOKIE)?.value ?? null;
    const verified = verifyOAuthState(state, clientSecret, nonce);
    if (!verified.valid) {
      console.error(
        '[youtube oauth callback] state verification failed:',
        verified.reason
      );
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'state_' + verified.reason })
        )
      );
    }

    // Same replay guard as the Meta Ads callback: the session must be
    // an owner of the exact account the signed state was minted for.
    const ctx = await requireRole('owner');
    if (ctx.accountId !== verified.payload.accountId) {
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'account_mismatch' })
        )
      );
    }

    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri: oauthRedirectUri(appBase),
      clientId,
      clientSecret,
    });
    // prompt=consent should always yield one, but Google omits it in
    // rare re-consent edge cases — without it the worker can never
    // mint upload tokens, so treat as a failed connect.
    if (!tokens.refresh_token) {
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'no_refresh_token' })
        )
      );
    }

    const channel = await getMyChannel(tokens.access_token);
    if (!channel) {
      return clearNonceCookie(
        NextResponse.redirect(
          settingsUrl(appBase, { youtube_error: 'no_channel' })
        )
      );
    }

    await supabaseAdmin()
      .from('youtube_config')
      .upsert(
        {
          account_id: ctx.accountId,
          refresh_token: encrypt(tokens.refresh_token),
          channel_id: channel.id,
          channel_title: channel.title,
          status: 'connected',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      );

    return clearNonceCookie(
      NextResponse.redirect(settingsUrl(appBase, { youtube_connected: '1' }))
    );
  } catch (err) {
    console.error('[GET /api/youtube/oauth/callback] failed:', err);
    return clearNonceCookie(
      NextResponse.redirect(
        settingsUrl(appBase, { youtube_error: 'connection_failed' })
      )
    );
  }
}
